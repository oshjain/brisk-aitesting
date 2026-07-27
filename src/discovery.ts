import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOpenApiSummary, openApiOperationsToDiscoveryRoutes } from './openapi.js';
import type {
  Discoverer,
  DiscovererContext,
  ContractDriftReport,
  ContractDriftRoute,
  DiscoveryApiRoute,
  DiscoveryContract,
  DiscoveryResult,
  DiscoveryRoute,
} from './types.js';

type MatchedDriftRoute = ContractDriftReport['matchedRoutes'][number];

const COMMON_UI_ROUTES = ['/', '/login', '/dashboard', '/settings'];
const COMMON_API_ROUTES: readonly Pick<DiscoveryApiRoute, 'method' | 'path'>[] = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/me' },
];

export class BuiltinDiscoverer implements Discoverer {
  readonly name = 'builtin-discoverer';

  async discover(context: DiscovererContext): Promise<DiscoveryResult> {
    const warnings: string[] = [];
    const uiRoutes = new Map<string, DiscoveryRoute>();
    const apiRoutes = new Map<string, DiscoveryApiRoute>();
    const repoSignals: DiscoveryResult['repoSignals'][number][] = [];

    if (context.config.discovery.includeUi) {
      for (const path of COMMON_UI_ROUTES) {
        uiRoutes.set(path, { path, source: 'config', confidence: path === '/' ? 0.9 : 0.45 });
      }
    }

    if (context.config.discovery.includeApi) {
      for (const route of COMMON_API_ROUTES) {
        apiRoutes.set(`${route.method} ${route.path}`, { ...route, source: 'config', confidence: 0.45 });
      }
    }

    const repoPath = context.config.app.repoPath;
    if (repoPath !== undefined && context.config.discovery.includeRepo) {
      await discoverRepo(repoPath, { uiRoutes, apiRoutes, repoSignals, warnings });
    }

    const implementedApiRoutes = implementationRoutesFrom(apiRoutes);
    const contractApiRoutes = new Map<string, DiscoveryApiRoute>();
    const contracts = await discoverContracts(context, { apiRoutes, contractApiRoutes, warnings });
    const contractDrift = buildContractDriftReport({
      implementedRoutes: implementedApiRoutes,
      documentedRoutes: contractApiRoutes,
      contracts,
    });

    return {
      schemaVersion: 'brisk-aitesting.discovery.v1',
      app: {
        name: context.config.app.name,
        baseUrl: context.config.app.baseUrl,
        ...(context.config.app.repoPath !== undefined ? { repoPath: context.config.app.repoPath } : {}),
      },
      uiRoutes: [...uiRoutes.values()].sort((left, right) => right.confidence - left.confidence || left.path.localeCompare(right.path)),
      apiRoutes: [...apiRoutes.values()].sort((left, right) => right.confidence - left.confidence || `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`)),
      contracts,
      ...(contractDrift !== undefined ? { contractDrift } : {}),
      repoSignals,
      warnings,
      createdAt: new Date().toISOString(),
    };
  }
}

async function discoverRepo(repoPath: string, state: {
  readonly uiRoutes: Map<string, DiscoveryRoute>;
  readonly apiRoutes: Map<string, DiscoveryApiRoute>;
  readonly repoSignals: DiscoveryResult['repoSignals'][number][];
  readonly warnings: string[];
}): Promise<void> {
  try {
    const packageJsonPath = join(repoPath, 'package.json');
    const rawPackage = await readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(rawPackage) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const name of Object.keys(deps)) {
      if (['next', 'react-router-dom', '@remix-run/react', 'express', 'fastify', '@playwright/test', 'vitest'].includes(name)) {
        state.repoSignals.push({
          kind: name === '@playwright/test' || name === 'vitest' ? 'test-runner' : name === 'express' || name === 'fastify' ? 'framework' : 'package',
          value: name,
          source: 'package.json',
        });
      }
    }
  } catch (error) {
    state.warnings.push(`Could not inspect package.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  await discoverRouteFiles(repoPath, state);
}

async function discoverRouteFiles(repoPath: string, state: {
  readonly uiRoutes: Map<string, DiscoveryRoute>;
  readonly apiRoutes: Map<string, DiscoveryApiRoute>;
  readonly repoSignals: DiscoveryResult['repoSignals'][number][];
  readonly warnings: string[];
}): Promise<void> {
  const files = await listSourceFiles(repoPath, 500);
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    state.repoSignals.push({ kind: 'source-file', value: normalized, source: 'repo' });
    for (const route of routeHintsFromPath(normalized)) {
      state.uiRoutes.set(route, { path: route, source: 'repo', confidence: 0.7 });
    }
    try {
      const content = await readFile(join(repoPath, file), 'utf8');
      for (const route of apiRouteHintsFromContent(content)) {
        state.apiRoutes.set(`${route.method} ${route.path}`, { ...route, source: 'repo', confidence: 0.7 });
      }
    } catch {
      // Ignore unreadable source files; route discovery is opportunistic.
    }
  }
}

async function listSourceFiles(root: string, limit: number): Promise<readonly string[]> {
  const result: string[] = [];
  await walk(root, '', result, limit);
  return result;
}

async function walk(root: string, relativeDir: string, result: string[], limit: number): Promise<void> {
  if (result.length >= limit) return;
  const absoluteDir = join(root, relativeDir);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (result.length >= limit) return;
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) continue;
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, relativePath, result, limit);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      result.push(relativePath);
    }
  }
}

function routeHintsFromPath(path: string): readonly string[] {
  const routes: string[] = [];
  const pageMatch = path.match(/(?:pages|routes|app)\/(.+?)\.(?:tsx?|jsx?|mjs|cjs)$/);
  if (pageMatch?.[1] !== undefined) {
    const route = `/${pageMatch[1]}`
      .replace(/\/index$/, '/')
      .replace(/\/page$/, '')
      .replace(/\[(.+?)\]/g, ':$1')
      .replace(/\/+/g, '/');
    routes.push(route === '' ? '/' : route);
  }
  return routes;
}

function apiRouteHintsFromContent(content: string): readonly Pick<DiscoveryApiRoute, 'method' | 'path'>[] {
  const routes: Pick<DiscoveryApiRoute, 'method' | 'path'>[] = [];
  const patterns = [
    /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi,
    /\b(request|get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]+)['"`]/gi,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const method = String(match[1] ?? 'GET').toUpperCase();
      const path = String(match[2] ?? '');
      if (path.startsWith('/api/')) routes.push({ method, path });
    }
  }
  return routes;
}

async function discoverContracts(context: DiscovererContext, state: {
  readonly apiRoutes: Map<string, DiscoveryApiRoute>;
  readonly contractApiRoutes: Map<string, DiscoveryApiRoute>;
  readonly warnings: string[];
}): Promise<readonly DiscoveryContract[]> {
  if (!context.config.discovery.includeContracts) return [];
  const configured: DiscoveryContract[] = [];
  if (context.config.contracts?.openApiPath !== undefined) {
    const existsOnDisk = await exists(context.config.contracts.openApiPath);
    if (existsOnDisk) {
      try {
        const summary = await loadOpenApiSummary(context.config.contracts.openApiPath);
        for (const route of openApiOperationsToDiscoveryRoutes(summary)) {
          const key = routeKey(route.method, route.path);
          state.contractApiRoutes.set(key, route);
          state.apiRoutes.set(key, route);
        }
        configured.push({
          kind: 'openapi',
          path: context.config.contracts.openApiPath,
          exists: true,
          operations: summary.operations.length,
          ...(summary.diagnostics.length > 0 ? { errors: summary.diagnostics } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.warnings.push(`Could not parse OpenAPI contract ${context.config.contracts.openApiPath}: ${message}`);
        configured.push({
          kind: 'openapi',
          path: context.config.contracts.openApiPath,
          exists: true,
          operations: 0,
          errors: [message],
        });
      }
    } else {
      state.warnings.push(`Configured OpenAPI contract does not exist: ${context.config.contracts.openApiPath}`);
      configured.push({
        kind: 'openapi',
        path: context.config.contracts.openApiPath,
        exists: false,
      });
    }
  }
  if (context.config.contracts?.asyncApiPath !== undefined) {
    configured.push({
      kind: 'asyncapi',
      path: context.config.contracts.asyncApiPath,
      exists: await exists(context.config.contracts.asyncApiPath),
    });
  }
  return configured;
}

function implementationRoutesFrom(routes: Map<string, DiscoveryApiRoute>): Map<string, DiscoveryApiRoute> {
  const result = new Map<string, DiscoveryApiRoute>();
  for (const route of routes.values()) {
    if (route.source === 'repo' || route.source === 'runtime') {
      result.set(routeKey(route.method, route.path), route);
    }
  }
  return result;
}

function buildContractDriftReport(params: {
  readonly implementedRoutes: Map<string, DiscoveryApiRoute>;
  readonly documentedRoutes: Map<string, DiscoveryApiRoute>;
  readonly contracts: readonly DiscoveryContract[];
}): ContractDriftReport | undefined {
  if (params.documentedRoutes.size === 0 && !params.contracts.some((contract) => contract.kind === 'openapi' && contract.exists)) {
    return undefined;
  }

  const matchedRoutes: MatchedDriftRoute[] = [];
  const implementedButUndocumented: ContractDriftRoute[] = [];
  const documentedButNotImplemented: ContractDriftRoute[] = [];

  for (const [key, implementation] of params.implementedRoutes) {
    const contract = params.documentedRoutes.get(key);
    if (contract === undefined) {
      implementedButUndocumented.push(toDriftRoute(implementation));
    } else {
      matchedRoutes.push({
        method: implementation.method.toUpperCase(),
        path: normalizeRoutePath(implementation.path),
        implementation: toDriftRoute(implementation),
        contract: toDriftRoute(contract),
      });
    }
  }

  for (const [key, contract] of params.documentedRoutes) {
    if (!params.implementedRoutes.has(key)) {
      documentedButNotImplemented.push(toDriftRoute(contract));
    }
  }

  const diagnostics: string[] = [
    `Compared ${params.implementedRoutes.size} implemented route(s) discovered from repo/runtime evidence with ${params.documentedRoutes.size} OpenAPI operation(s).`,
  ];
  if (params.implementedRoutes.size === 0) {
    diagnostics.push('No repo/runtime API routes were discovered; config default API route candidates are not treated as implementation evidence.');
  }
  if (implementedButUndocumented.length === 0 && documentedButNotImplemented.length === 0 && params.documentedRoutes.size > 0) {
    diagnostics.push('No implementation-contract drift detected for discovered route keys.');
  }

  const openApiContract = params.contracts.find((contract) => contract.kind === 'openapi' && contract.exists);
  return {
    schemaVersion: 'brisk-aitesting.contract-drift.v1',
    kind: 'openapi',
    ...(openApiContract?.path !== undefined ? { contractPath: openApiContract.path } : {}),
    implementedRoutes: [...params.implementedRoutes.values()].map(toDriftRoute).sort(compareDriftRoutes),
    documentedRoutes: [...params.documentedRoutes.values()].map(toDriftRoute).sort(compareDriftRoutes),
    matchedRoutes: matchedRoutes.sort((left, right) => compareRouteParts(left.method, left.path, right.method, right.path)),
    implementedButUndocumented: implementedButUndocumented.sort(compareDriftRoutes),
    documentedButNotImplemented: documentedButNotImplemented.sort(compareDriftRoutes),
    diagnostics,
  };
}

function toDriftRoute(route: DiscoveryApiRoute): ContractDriftRoute {
  return {
    method: route.method.toUpperCase(),
    path: normalizeRoutePath(route.path),
    source: route.source,
    confidence: route.confidence,
    ...(route.operationId !== undefined ? { operationId: route.operationId } : {}),
    ...(route.contractPath !== undefined ? { contractPath: route.contractPath } : {}),
  };
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeRoutePath(path)}`;
}

function normalizeRoutePath(path: string): string {
  if (path === '') return '/';
  const normalized = path.replace(/\/+/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

function compareDriftRoutes(left: ContractDriftRoute, right: ContractDriftRoute): number {
  return compareRouteParts(left.method, left.path, right.method, right.path);
}

function compareRouteParts(leftMethod: string, leftPath: string, rightMethod: string, rightPath: string): number {
  return leftPath.localeCompare(rightPath) || leftMethod.localeCompare(rightMethod);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
