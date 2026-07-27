import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile, access, readFile, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { loadOpenApiSummary } from '../openapi.js';
import { validateJsonSchema } from '../schema.js';
import type { ArtifactRef, DiscoveryApiRoute, Engine, EngineContext, EngineRunResult, OpenApiOperationSummary, ScenarioPlan, ScenarioResult, UiGroundingEvidence, UiRouteGrounder, UiRouteGrounderContext, UiRouteGrounderResult } from '../types.js';

type HeaderRecord = Record<string, string>;
type StatusExpectation = NonNullable<NonNullable<ScenarioPlan['expect']>['status']>;

export class BuiltinPlaywrightRouteGrounder implements UiRouteGrounder {
  readonly name = 'builtin-playwright-route-grounder';

  async ground(context: UiRouteGrounderContext): Promise<UiRouteGrounderResult> {
    const artifactsRoot = resolve(context.config.runtime.artifactsDir);
    const repoRoot = resolve(context.config.app.repoPath ?? process.cwd());
    const dir = join(artifactsRoot, context.runId, 'grounding');
    const workDir = join(repoRoot, 'brisk-aitesting-playwright-work', context.runId, `${context.scenario.id}-grounding`);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    const route = context.scenario.target?.route ?? '/';
    const targetUrl = new URL(route, context.config.app.baseUrl).toString();
    const groundingPath = join(dir, `${context.scenario.id}.ui-grounding.json`);
    const specPath = join(workDir, `${context.scenario.id}.grounding.spec.ts`);
    const configPath = join(workDir, 'playwright.config.cjs');
    const logPath = join(dir, `${context.scenario.id}.grounding.log`);
    const testFile = [
      "import { writeFileSync } from 'node:fs';",
      "import { test, expect } from '@playwright/test';",
      `test.use({ trace: 'off', screenshot: 'off', headless: ${JSON.stringify(context.config.runtime.headless)} });`,
      `test(${JSON.stringify(`${context.scenario.name} route grounding`)}, async ({ page }) => {`,
      `  await page.goto(${JSON.stringify(targetUrl)});`,
      "  await expect(page.locator('body')).toBeVisible();",
      `  const grounding = await page.evaluate(${browserGroundingFunctionSource()}, ${JSON.stringify({
        scenario: {
          id: context.scenario.id,
          name: context.scenario.name,
          objective: context.scenario.objective,
        },
        route,
        url: targetUrl,
      })});`,
      `  writeFileSync(${JSON.stringify(groundingPath)}, JSON.stringify(grounding, null, 2) + '\\n', 'utf8');`,
      '});',
      '',
    ].join('\n');
    await writeFile(specPath, testFile, 'utf8');
    await writeFile(configPath, playwrightConfigSource(specPath), 'utf8');
    const cliPath = resolvePlaywrightCli();
    const execution = await runProcess(
      process.execPath,
      [
        cliPath,
        'test',
        basename(specPath),
        `--config=${toPlaywrightPath(configPath)}`,
        '--reporter=line',
        `--timeout=${Math.max(1_000, context.config.runtime.timeoutMs)}`,
        '--workers=1',
      ],
      {
        cwd: workDir,
        timeoutMs: context.config.runtime.timeoutMs + 30_000,
      },
    );
    await rm(workDir, { recursive: true, force: true });
    await writeFile(logPath, [execution.stdout, execution.stderr].filter((part) => part.trim().length > 0).join('\n\n'), 'utf8');
    if (execution.exitCode !== 0) {
      throw new Error(`Route grounding failed for ${route}: ${firstUsefulLine(execution.stderr || execution.stdout)}`);
    }
    const grounding = JSON.parse(await readFile(groundingPath, 'utf8')) as UiGroundingEvidence;
    return {
      grounding,
      artifacts: [
        {
          kind: 'json',
          path: groundingPath,
          label: 'Pre-execution UI grounding evidence',
          metadata: {
            schemaVersion: 'brisk-aitesting.ui-grounding.v1',
            scenarioId: context.scenario.id,
            phase: 'pre-execution',
            elements: grounding.summary.total,
            actionable: grounding.summary.actionable,
          },
        },
        {
          kind: 'log',
          path: logPath,
          label: 'Pre-execution UI grounding log',
          metadata: { scenarioId: context.scenario.id, phase: 'pre-execution' },
        },
      ],
    };
  }
}

export class BuiltinApiEngine implements Engine {
  readonly name = 'builtin-api-engine';
  readonly type = 'api' as const;

  canRun(scenario: ScenarioPlan): boolean {
    return scenario.type === 'api';
  }

  async run(context: EngineContext): Promise<EngineRunResult> {
    const started = Date.now();
    const dir = join(context.config.runtime.artifactsDir, context.runId, 'api');
    await mkdir(dir, { recursive: true });
    const artifactPath = join(dir, `${context.scenario.id}.request-response.json`);
    const url = apiUrl(context);
    const contractRoute = findContractRoute(context);
    const contractOperation = contractRoute === undefined ? undefined : await findContractOperation(contractRoute);
    const headers: HeaderRecord = {
      ...authHeaders(context.config.auth),
      ...context.scenario.request?.headers,
    };
    const method = context.scenario.target?.method ?? 'GET';
    let status: ScenarioResult['status'] = 'passed';
    const diagnostics: string[] = [];
    const assertions: ScenarioResult['assertions'][number][] = [];
    let responseDurationMs = 0;
    let artifactPayload: unknown = {
      schemaVersion: 'brisk-aitesting.api-evidence.v1',
      scenario: scenarioEvidence(context),
      request: {
        method,
        url: url.toString(),
        headers: redactHeaders(headers, context.config.security.redactSecrets),
        body: redactValue(context.scenario.request?.body, context.config.security.redactSecrets),
      },
      response: null,
    };

    if (context.config.runtime.dryRun) {
      status = 'skipped';
      diagnostics.push('Dry run enabled; API request was planned but not executed.');
    } else if (isHostAllowed(url, context.config.security.allowedHosts, context.config.security.networkPolicy)) {
      try {
        const requestStarted = Date.now();
        const response = await fetch(url, {
          method,
          headers,
          ...(context.scenario.request?.body !== undefined ? { body: serializeBody(context.scenario.request.body, headers) } : {}),
          signal: AbortSignal.timeout(context.config.runtime.timeoutMs),
        });
        responseDurationMs = Date.now() - requestStarted;
        const responseText = await response.text();
        const responseJson = parseJsonOrNull(responseText);
        assertions.push(assertStatus(response.status, context.scenario.expect?.status));
        const contractStatusAssertion = assertContractStatus(response.status, contractRoute, context.scenario.expect?.status);
        if (contractStatusAssertion !== undefined) assertions.push(contractStatusAssertion);
        if (context.scenario.expect?.json !== undefined) {
          assertions.push(...assertJsonShape(responseJson, context.scenario.expect.json));
        }
        if (context.scenario.expect?.contains !== undefined) {
          assertions.push({
            name: `response contains ${context.scenario.expect.contains}`,
            status: responseText.includes(context.scenario.expect.contains) ? 'passed' : 'failed',
            ...(responseText.includes(context.scenario.expect.contains) ? {} : { message: 'Expected text was not found in response body.' }),
          });
        }
        const responseSchemaAssertion = assertResponseSchema(response.status, response.headers, responseJson, contractOperation);
        if (responseSchemaAssertion !== undefined) assertions.push(responseSchemaAssertion);
        if (assertions.length === 0) {
          assertions.push({ name: 'response status is below 500', status: response.status < 500 ? 'passed' : 'failed' });
        }
        if (assertions.some((assertion) => assertion.status === 'failed')) status = 'failed';
        diagnostics.push(`HTTP ${response.status} ${response.statusText}`);
        artifactPayload = {
          schemaVersion: 'brisk-aitesting.api-evidence.v1',
          scenario: scenarioEvidence(context),
          timing: {
            startedAt: new Date(requestStarted).toISOString(),
            durationMs: responseDurationMs,
          },
          request: {
            method,
            url: url.toString(),
            headers: redactHeaders(headers, context.config.security.redactSecrets),
            body: redactValue(context.scenario.request?.body, context.config.security.redactSecrets),
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: headersToRecord(response.headers),
            body: responseJson ?? responseText,
          },
          ...(contractRoute !== undefined ? { contract: contractRouteEvidence(contractRoute, contractOperation) } : {}),
          assertions,
          diagnostics,
        };
      } catch (error) {
        status = 'error';
        diagnostics.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      status = 'skipped';
      diagnostics.push(`Network policy blocked host ${url.hostname}`);
    }

    await writeFile(artifactPath, `${JSON.stringify(artifactPayload, null, 2)}\n`, 'utf8');
    const artifact: ArtifactRef = {
      kind: 'json',
      path: artifactPath,
      label: 'API request/response',
      metadata: {
        schemaVersion: 'brisk-aitesting.api-evidence.v1',
        scenarioId: context.scenario.id,
        method,
        url: url.toString(),
        durationMs: responseDurationMs,
        ...(contractRoute !== undefined ? { contractPath: contractRoute.contractPath, operationId: contractRoute.operationId } : {}),
      },
    };

    return {
      artifacts: [artifact],
      result: scenarioResult(context, {
        engine: this.name,
        status,
        durationMs: Date.now() - started,
        artifacts: [artifact],
        diagnostics,
        ...(assertions.length > 0 ? { assertions } : {}),
      }),
    };
  }
}

export class BuiltinPlaywrightEngine implements Engine {
  readonly name = 'builtin-playwright-engine';
  readonly type = 'ui' as const;

  canRun(scenario: ScenarioPlan): boolean {
    return scenario.type === 'ui';
  }

  async run(context: EngineContext): Promise<EngineRunResult> {
    const started = Date.now();
    const artifactsRoot = resolve(context.config.runtime.artifactsDir);
    const repoRoot = resolve(context.config.app.repoPath ?? process.cwd());
    const dir = join(artifactsRoot, context.runId, 'playwright');
    const workDir = join(repoRoot, 'brisk-aitesting-playwright-work', context.runId, context.scenario.id);
    const outputDir = join(dir, `${context.scenario.id}-results`);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    const artifactSpecPath = join(dir, `${context.scenario.id}.spec.ts`);
    const executableSpecPath = join(workDir, `${context.scenario.id}.spec.ts`);
    const configPath = join(workDir, 'playwright.config.cjs');
    const reportPath = join(dir, `${context.scenario.id}.report.json`);
    const logPath = join(dir, `${context.scenario.id}.log`);
    const manifestPath = join(dir, `${context.scenario.id}.evidence.json`);
    const groundingPath = join(dir, `${context.scenario.id}.ui-grounding.json`);
    const actionEvidencePath = join(dir, `${context.scenario.id}.ui-actions.json`);
    const route = context.scenario.target?.route ?? '/';
    const targetUrl = new URL(route, context.config.app.baseUrl).toString();
    const uiActions = context.scenario.uiActions ?? [];
    const testFile = [
      "import { writeFileSync } from 'node:fs';",
      "import { test, expect } from '@playwright/test';",
      '',
      `test.use({ trace: 'on', screenshot: 'on', headless: ${JSON.stringify(context.config.runtime.headless)} });`,
      '',
      `test(${JSON.stringify(context.scenario.name)}, async ({ page }) => {`,
      `  await page.goto(${JSON.stringify(targetUrl)});`,
      "  await expect(page.locator('body')).toBeVisible();",
      "  const bodyText = await page.locator('body').innerText();",
      "  expect(bodyText.trim().length).toBeGreaterThan(0);",
      `  const grounding = await page.evaluate(${browserGroundingFunctionSource()}, ${JSON.stringify({
        scenario: {
          id: context.scenario.id,
          name: context.scenario.name,
          objective: context.scenario.objective,
        },
        route,
        url: targetUrl,
      })});`,
      `  writeFileSync(${JSON.stringify(groundingPath)}, JSON.stringify(grounding, null, 2) + '\\n', 'utf8');`,
      `  const actionLog = [];`,
      `  const actions = ${JSON.stringify(uiActions)};`,
      `  for (const action of actions) {`,
      `    const evidence = grounding.elements.find((element) => element.id === action.evidenceId);`,
      `    if (!evidence) throw new Error('Grounded UI action references missing evidenceId ' + action.evidenceId);`,
      `    const locator = (${playwrightLocatorFunctionSource()})(page, evidence);`,
      `    await locator.first().waitFor({ state: 'visible', timeout: 5000 });`,
      `    if (action.action === 'fill') await locator.first().fill(action.value);`,
      `    else if (action.action === 'click') await locator.first().click();`,
      `    else if (action.action === 'check') await locator.first().check();`,
      `    else if (action.action === 'select') await locator.first().selectOption(action.value);`,
      `    else if (action.action === 'press') await locator.first().press(action.key);`,
      `    else if (action.action === 'assertText') await expect(locator.first()).toContainText(action.text);`,
      `    else throw new Error('Unsupported grounded UI action ' + action.action);`,
      `    actionLog.push({ action: action.action, evidenceId: action.evidenceId, locator: evidence.locator, status: 'passed' });`,
      `  }`,
      `  writeFileSync(${JSON.stringify(actionEvidencePath)}, JSON.stringify({ schemaVersion: 'brisk-aitesting.ui-actions.v1', scenario: ${JSON.stringify(scenarioEvidence(context))}, actions: actionLog }, null, 2) + '\\n', 'utf8');`,
      '});',
      '',
    ].join('\n');
    await writeFile(artifactSpecPath, testFile, 'utf8');
    await writeFile(executableSpecPath, testFile, 'utf8');
    await writeFile(configPath, playwrightConfigSource(executableSpecPath), 'utf8');

    const testArtifact: ArtifactRef = {
      kind: 'test-file',
      path: artifactSpecPath,
      label: 'Generated Playwright test',
      metadata: {
        scenarioId: context.scenario.id,
        route,
      },
    };

    if (context.config.runtime.dryRun) {
      return {
        artifacts: [testArtifact],
        result: scenarioResult(context, {
          engine: this.name,
          status: 'skipped',
          durationMs: Date.now() - started,
          artifacts: [testArtifact],
          diagnostics: ['Dry run enabled; Playwright test file generated but not executed.'],
        }),
      };
    }

    const cliPath = resolvePlaywrightCli();
    const outputArg = toPlaywrightPath(outputDir);
    const execution = await runProcess(
      process.execPath,
      [
        cliPath,
        'test',
        basename(executableSpecPath),
        `--config=${toPlaywrightPath(configPath)}`,
        '--reporter=json',
        `--output=${outputArg}`,
        `--timeout=${Math.max(1_000, context.config.runtime.timeoutMs)}`,
        `--retries=${Math.max(0, context.config.runtime.retries)}`,
        '--workers=1',
      ],
      {
        cwd: workDir,
        timeoutMs: context.config.runtime.timeoutMs + 30_000,
        env: {
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        },
      },
    );
    await rm(workDir, { recursive: true, force: true });

    await writeFile(logPath, [
      execution.stdout,
      execution.stderr,
    ].filter((part) => part.trim().length > 0).join('\n\n'), 'utf8');

    const collectedArtifacts = await collectPlaywrightArtifacts(outputDir);
    const reportSummary = await parsePlaywrightReport(reportPath);
    const groundingSummary = await readUiGroundingSummary(groundingPath);
    const groundingArtifact: ArtifactRef = {
      kind: 'json',
      path: groundingPath,
      label: 'UI grounding evidence',
      metadata: {
        schemaVersion: 'brisk-aitesting.ui-grounding.v1',
        scenarioId: context.scenario.id,
        elements: groundingSummary.total,
        actionable: groundingSummary.actionable,
      },
    };
    const actionArtifact: ArtifactRef = {
      kind: 'json',
      path: actionEvidencePath,
      label: 'Grounded UI action evidence',
      metadata: {
        schemaVersion: 'brisk-aitesting.ui-actions.v1',
        scenarioId: context.scenario.id,
        actions: uiActions.length,
      },
    };
    const manifestArtifact: ArtifactRef = {
      kind: 'json',
      path: manifestPath,
      label: 'Playwright evidence manifest',
      metadata: {
        schemaVersion: 'brisk-aitesting.playwright-evidence.v1',
        scenarioId: context.scenario.id,
      },
    };
    const artifacts: ArtifactRef[] = [
      testArtifact,
      { kind: 'json', path: reportPath, label: 'Playwright JSON report', metadata: { scenarioId: context.scenario.id } },
      { kind: 'log', path: logPath, label: 'Playwright execution log', metadata: { scenarioId: context.scenario.id } },
      groundingArtifact,
      actionArtifact,
      ...collectedArtifacts,
      manifestArtifact,
    ];
    const diagnostics = summarizePlaywrightExecution(execution, reportPath, reportSummary);
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 'brisk-aitesting.playwright-evidence.v1',
      scenario: scenarioEvidence(context),
      target: {
        route,
        url: new URL(route, context.config.app.baseUrl).toString(),
      },
      execution: {
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        durationMs: Date.now() - started,
      },
      report: reportSummary,
      grounding: {
        schemaVersion: 'brisk-aitesting.ui-grounding.v1',
        path: groundingPath,
        summary: groundingSummary,
      },
      actions: {
        schemaVersion: 'brisk-aitesting.ui-actions.v1',
        path: actionEvidencePath,
        planned: uiActions.length,
      },
      artifacts: artifacts.filter((artifact) => artifact.path !== manifestPath),
      diagnostics,
    }, null, 2)}\n`, 'utf8');

    return {
      artifacts,
      result: scenarioResult(context, {
        engine: this.name,
        status: execution.exitCode === 0 ? 'passed' : execution.timedOut ? 'error' : 'failed',
        durationMs: Date.now() - started,
        artifacts,
        diagnostics,
        ...(reportSummary.assertions.length > 0 ? { assertions: reportSummary.assertions } : {}),
      }),
    };
  }
}

export class BuiltinContractEngine implements Engine {
  readonly name = 'builtin-contract-engine';
  readonly type = 'contract' as const;

  canRun(scenario: ScenarioPlan): boolean {
    return scenario.type === 'contract' || scenario.type === 'schema';
  }

  async run(context: EngineContext): Promise<EngineRunResult> {
    const started = Date.now();
    const dir = join(context.config.runtime.artifactsDir, context.runId, 'contracts');
    await mkdir(dir, { recursive: true });
    const contractPath = context.scenario.target?.schema ?? context.config.contracts?.openApiPath ?? context.config.contracts?.asyncApiPath;
    const artifactPath = join(dir, `${context.scenario.id}.openapi-summary.json`);
    const diagnostics: string[] = [];
    const assertions: ScenarioResult['assertions'][number][] = [];
    const artifacts: ArtifactRef[] = [];
    let status: ScenarioResult['status'] = 'skipped';

    if (contractPath === undefined) {
      diagnostics.push('No OpenAPI or AsyncAPI contract configured.');
      assertions.push({ name: 'contract is configured', status: 'skipped' });
    } else {
      try {
        await access(contractPath);
        if (isOpenApiContractPath(contractPath, context)) {
          const summary = await loadOpenApiSummary(contractPath);
          assertions.push({ name: `OpenAPI contract is valid ${summary.format.toUpperCase()}`, status: 'passed' });
          assertions.push({
            name: 'OpenAPI contract exposes operations',
            status: summary.operations.length > 0 ? 'passed' : 'failed',
            ...(summary.operations.length > 0 ? {} : { message: 'No HTTP operations were found in paths.' }),
          });
          assertions.push({
            name: 'OpenAPI operations define method and path',
            status: summary.operations.every((operation) => operation.method.length > 0 && operation.path.startsWith('/')) ? 'passed' : 'failed',
          });
          for (const diagnostic of summary.diagnostics) diagnostics.push(diagnostic);
          status = assertions.some((assertion) => assertion.status === 'failed') ? 'failed' : 'passed';
          await writeFile(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
          artifacts.push({
            kind: 'json',
            path: artifactPath,
            label: 'OpenAPI operation summary',
            metadata: {
              schemaVersion: 'brisk-aitesting.openapi-summary.v1',
              scenarioId: context.scenario.id,
              operations: summary.operations.length,
            },
          });
          diagnostics.push(`OpenAPI contract parsed: ${contractPath}`);
        } else {
          const content = await readFile(contractPath, 'utf8');
          JSON.parse(content);
          status = 'passed';
          assertions.push({ name: 'contract is valid JSON', status: 'passed' });
          diagnostics.push(`Contract parsed: ${contractPath}`);
        }
      } catch (error) {
        status = 'failed';
        const message = error instanceof Error ? error.message : String(error);
        assertions.push({ name: 'contract parses', status: 'failed', message });
        diagnostics.push(message);
      }
    }

    return {
      ...(artifacts.length > 0 ? { artifacts } : {}),
      result: scenarioResult(context, {
        engine: this.name,
        status,
        durationMs: Date.now() - started,
        ...(artifacts.length > 0 ? { artifacts } : {}),
        diagnostics,
        ...(assertions.length > 0 ? { assertions } : {}),
      }),
    };
  }
}

function scenarioResult(
  context: EngineContext,
  params: {
    readonly engine: string;
    readonly status: ScenarioResult['status'];
    readonly durationMs: number;
    readonly artifacts?: readonly ArtifactRef[];
    readonly diagnostics: readonly string[];
    readonly assertions?: readonly ScenarioResult['assertions'][number][];
  },
): ScenarioResult {
  return {
    scenarioId: context.scenario.id,
    name: context.scenario.name,
    type: context.scenario.type,
    engine: params.engine,
    status: params.status,
    durationMs: params.durationMs,
    assertions: params.assertions ?? context.scenario.assertions.map((assertion) => ({
      name: assertion,
      status: params.status === 'passed' ? 'passed' : params.status,
    })),
    artifacts: params.artifacts ?? [],
    diagnostics: params.diagnostics,
  };
}

function scenarioEvidence(context: EngineContext): Record<string, unknown> {
  return {
    id: context.scenario.id,
    name: context.scenario.name,
    type: context.scenario.type,
    objective: context.scenario.objective,
  };
}

function isOpenApiContractPath(contractPath: string, context: EngineContext): boolean {
  if (contractPath === context.config.contracts?.openApiPath) return true;
  if (contractPath === context.config.contracts?.asyncApiPath) return false;
  return /\.(json|ya?ml)$/i.test(contractPath);
}

function authHeaders(auth: EngineContext['config']['auth']): HeaderRecord {
  if (auth.type === 'bearer') return { authorization: `Bearer ${auth.token}` };
  return {};
}

function apiUrl(context: EngineContext): URL {
  const url = new URL(context.scenario.target?.path ?? '/', context.config.app.baseUrl);
  const query = context.scenario.request?.query;
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function findContractRoute(context: EngineContext): DiscoveryApiRoute | undefined {
  const scenarioMethod = (context.scenario.target?.method ?? 'GET').toUpperCase();
  const scenarioPath = context.scenario.target?.path;
  if (scenarioPath === undefined) return undefined;
  return context.plan.discovery.apiRoutes.find((route) => (
    route.source === 'contract'
    && route.method.toUpperCase() === scenarioMethod
    && route.path === scenarioPath
  ));
}

async function findContractOperation(route: DiscoveryApiRoute): Promise<OpenApiOperationSummary | undefined> {
  if (route.contractPath === undefined) return undefined;
  try {
    const summary = await loadOpenApiSummary(route.contractPath);
    return summary.operations.find((operation) => (
      operation.method.toUpperCase() === route.method.toUpperCase()
      && operation.path === route.path
    ));
  } catch {
    return undefined;
  }
}

function contractRouteEvidence(route: DiscoveryApiRoute, operation: OpenApiOperationSummary | undefined): Record<string, unknown> {
  return {
    method: route.method,
    path: route.path,
    ...(route.operationId !== undefined ? { operationId: route.operationId } : {}),
    ...(route.summary !== undefined ? { summary: route.summary } : {}),
    ...(route.tags !== undefined ? { tags: route.tags } : {}),
    ...(route.contractPath !== undefined ? { contractPath: route.contractPath } : {}),
    ...(route.statusCodes !== undefined ? { statusCodes: route.statusCodes } : {}),
    ...(operation?.responseSchemas !== undefined ? { responseSchemas: operation.responseSchemas } : {}),
  };
}

function serializeBody(body: unknown, headers: Record<string, string>): BodyInit {
  if (typeof body === 'string') return body;
  if (!hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
  return JSON.stringify(body);
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function parseJsonOrNull(value: string): unknown | null {
  if (value.trim().length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assertStatus(actual: number, expected: StatusExpectation | undefined): ScenarioResult['assertions'][number] {
  if (expected === undefined) {
    return { name: 'response status is below 500', status: actual < 500 ? 'passed' : 'failed', ...(actual < 500 ? {} : { message: `Expected status below 500, got ${actual}.` }) };
  }
  if (typeof expected === 'number') {
    return { name: `status is ${expected}`, status: actual === expected ? 'passed' : 'failed', ...(actual === expected ? {} : { message: `Expected ${expected}, got ${actual}.` }) };
  }
  if (isReadonlyNumberArray(expected)) {
    return { name: `status is one of ${expected.join(', ')}`, status: expected.includes(actual) ? 'passed' : 'failed', ...(expected.includes(actual) ? {} : { message: `Expected one of ${expected.join(', ')}, got ${actual}.` }) };
  }
  const min = expected.min ?? 100;
  const max = expected.max ?? 599;
  const passed = actual >= min && actual <= max;
  return { name: `status is between ${min} and ${max}`, status: passed ? 'passed' : 'failed', ...(passed ? {} : { message: `Expected ${min}-${max}, got ${actual}.` }) };
}

function assertContractStatus(
  actual: number,
  route: DiscoveryApiRoute | undefined,
  explicitExpectation: StatusExpectation | undefined,
): ScenarioResult['assertions'][number] | undefined {
  if (route?.statusCodes === undefined || route.statusCodes.length === 0) return undefined;
  const passed = route.statusCodes.includes(actual);
  return {
    name: explicitExpectation === undefined
      ? `status is documented in contract: ${route.statusCodes.join(', ')}`
      : `explicit status is backed by contract: ${route.statusCodes.join(', ')}`,
    status: passed ? 'passed' : 'failed',
    ...(passed ? {} : { message: `Contract for ${route.method} ${route.path} documents ${route.statusCodes.join(', ')}, got ${actual}.` }),
  };
}

function assertResponseSchema(
  status: number,
  headers: Headers,
  body: unknown,
  operation: OpenApiOperationSummary | undefined,
): ScenarioResult['assertions'][number] | undefined {
  if (body === null || operation === undefined) return undefined;
  const contentType = headers.get('content-type') ?? '';
  const responseSchema = operation.responseSchemas.find((entry) => (
    entry.statusCode === status
    && entry.schema !== undefined
    && (entry.contentType === undefined || contentType.toLowerCase().includes(entry.contentType.toLowerCase()))
  ));
  if (responseSchema?.schema === undefined) return undefined;
  const validation = validateJsonSchema(responseSchema.schema, body);
  return {
    name: `response body matches OpenAPI schema for ${status}`,
    status: validation.valid ? 'passed' : 'failed',
    ...(validation.valid ? {} : { message: validation.errors.join('; ') }),
  };
}

function isReadonlyNumberArray(value: StatusExpectation): value is readonly number[] {
  return Array.isArray(value);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function assertJsonShape(actual: unknown, expected: Record<string, unknown>): readonly ScenarioResult['assertions'][number][] {
  return Object.entries(expected).map(([path, expectedValue]) => {
    const actualValue = getPath(actual, path);
    const passed = deepEqual(actualValue, expectedValue);
    return {
      name: `json.${path} equals ${JSON.stringify(expectedValue)}`,
      status: passed ? 'passed' : 'failed',
      ...(passed ? {} : { message: `Expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}.` }),
    };
  });
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function redactHeaders(headers: Record<string, string>, shouldRedact: boolean): Record<string, string> {
  if (!shouldRedact) return headers;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /authorization|cookie|token|secret|password/i.test(key) ? '[redacted]' : value,
  ]));
}

function redactValue(value: unknown, shouldRedact: boolean): unknown {
  if (!shouldRedact || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, shouldRedact));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    /token|secret|password|authorization/i.test(key) ? '[redacted]' : redactValue(entry, shouldRedact),
  ]));
}

function isHostAllowed(url: URL, allowedHosts: readonly string[], policy: EngineContext['config']['security']['networkPolicy']): boolean {
  if (policy === 'open') return true;
  if (policy === 'allowlist') return allowedHosts.includes(url.hostname);
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
}

function resolvePlaywrightCli(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@playwright/test/package.json');
  return join(dirname(packageJsonPath), 'cli.js');
}

function toPlaywrightPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function playwrightConfigSource(specPath: string): string {
  return [
    'module.exports = {',
    '  testDir: __dirname,',
    `  testMatch: [${JSON.stringify(basename(specPath))}],`,
    '  forbidOnly: true,',
    '  fullyParallel: false,',
    '};',
    '',
  ].join('\n');
}

async function runProcess(command: string, args: readonly string[], options: {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: Record<string, string>;
}): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}> {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      resolveProcess({ exitCode: null, stdout, stderr, timedOut: true });
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProcess({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut: false });
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProcess({ exitCode, stdout, stderr, timedOut: false });
    });
  });
}

async function collectPlaywrightArtifacts(outputDir: string): Promise<readonly ArtifactRef[]> {
  const entries = await listFiles(outputDir);
  return entries.map((path) => {
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) return { kind: 'trace' as const, path, label: 'Playwright trace', metadata: { source: 'playwright-output' } };
    if (lower.endsWith('.png')) return { kind: 'screenshot' as const, path, label: 'Playwright screenshot', metadata: { source: 'playwright-output' } };
    if (lower.endsWith('.webm')) return { kind: 'video' as const, path, label: 'Playwright video', metadata: { source: 'playwright-output' } };
    return { kind: 'other' as const, path, label: 'Playwright artifact', metadata: { source: 'playwright-output' } };
  });
}

async function listFiles(root: string): Promise<readonly string[]> {
  const result: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listFiles(absolute));
    } else if (entry.isFile()) {
      result.push(absolute);
    }
  }
  return result;
}

interface PlaywrightReportSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly errors: number;
  readonly durationMs?: number;
  readonly assertions: readonly ScenarioResult['assertions'][number][];
}

async function readUiGroundingSummary(path: string): Promise<UiGroundingEvidence['summary']> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (isRecord(parsed) && isRecord(parsed.summary)) {
      return {
        total: numberOrZero(parsed.summary.total),
        roles: isNumberRecord(parsed.summary.roles) ? parsed.summary.roles : {},
        labels: numberOrZero(parsed.summary.labels),
        testIds: numberOrZero(parsed.summary.testIds),
        actionable: numberOrZero(parsed.summary.actionable),
      };
    }
  } catch {
    // Missing grounding is reported through the manifest and smoke gates.
  }
  return { total: 0, roles: {}, labels: 0, testIds: 0, actionable: 0 };
}

function browserGroundingFunctionSource(): string {
  return `({ scenario, route, url }) => {
    const elements = [];
    const roleCounts = {};
    const actionableTags = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
    const roleFor = (element) => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      const tag = element.tagName;
      if (tag === 'A' && element.getAttribute('href')) return 'link';
      if (tag === 'BUTTON') return 'button';
      if (tag === 'INPUT') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'submit' || type === 'button') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      if (tag === 'TEXTAREA') return 'textbox';
      if (tag === 'SELECT') return 'combobox';
      if (/^H[1-6]$/.test(tag)) return 'heading';
      return undefined;
    };
    const labelFor = (element) => {
      if (element.labels && element.labels.length > 0) return Array.from(element.labels).map((label) => label.innerText.trim()).filter(Boolean).join(' ');
      const aria = element.getAttribute('aria-label');
      if (aria) return aria.trim();
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        return labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.innerText.trim()).filter(Boolean).join(' ');
      }
      return '';
    };
    const cssFor = (element) => {
      const testId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy');
      if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
      if (element.id) return '#' + CSS.escape(element.id);
      const name = element.getAttribute('name');
      if (name) return element.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
      return element.tagName.toLowerCase();
    };
    const textFor = (element) => (element.innerText || element.value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const candidates = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role],[data-testid],[data-test],[data-cy],label,h1,h2,h3'));
    candidates.slice(0, 200).forEach((element, index) => {
      const role = roleFor(element);
      const label = labelFor(element);
      const text = textFor(element);
      const testId = element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-cy') || '';
      let strategy = 'css';
      let value = cssFor(element);
      let kind = 'css';
      let confidence = 0.55;
      if (testId) {
        strategy = 'testId';
        value = testId;
        kind = 'testId';
        confidence = 0.98;
      } else if (label) {
        strategy = 'label';
        value = label;
        kind = 'label';
        confidence = 0.9;
      } else if (role && (text || label)) {
        strategy = 'role';
        value = role + ':' + (text || label);
        kind = 'role';
        confidence = 0.85;
      } else if (text) {
        strategy = 'text';
        value = text;
        kind = 'text';
        confidence = 0.7;
      }
      if (role) roleCounts[role] = (roleCounts[role] || 0) + 1;
      elements.push({
        id: 'ui_el_' + String(index + 1).padStart(3, '0'),
        kind,
        ...(role ? { role } : {}),
        ...(label ? { label } : {}),
        ...(text ? { text } : {}),
        ...(testId ? { testId } : {}),
        css: cssFor(element),
        tagName: element.tagName.toLowerCase(),
        ...(element.getAttribute('type') ? { inputType: element.getAttribute('type') } : {}),
        locator: { strategy, value },
        confidence,
      });
    });
    return {
      schemaVersion: 'brisk-aitesting.ui-grounding.v1',
      scenario,
      route,
      url,
      title: document.title,
      capturedAt: new Date().toISOString(),
      elements,
      summary: {
        total: elements.length,
        roles: roleCounts,
        labels: elements.filter((element) => element.label).length,
        testIds: elements.filter((element) => element.testId).length,
        actionable: elements.filter((element) => actionableTags.has(element.tagName.toUpperCase()) || ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox'].includes(element.role || '')).length,
      },
    };
  }`;
}

function playwrightLocatorFunctionSource(): string {
  return `(page, evidence) => {
    if (evidence.locator?.strategy === 'testId') return page.getByTestId(evidence.locator.value);
    if (evidence.locator?.strategy === 'label') return page.getByLabel(evidence.locator.value);
    if (evidence.locator?.strategy === 'role') {
      const [role, ...nameParts] = String(evidence.locator.value).split(':');
      const name = nameParts.join(':');
      return name ? page.getByRole(role, { name }) : page.getByRole(role);
    }
    if (evidence.locator?.strategy === 'text') return page.getByText(evidence.locator.value);
    if (evidence.css) return page.locator(evidence.css);
    return page.locator(evidence.tagName || 'body');
  }`;
}

async function parsePlaywrightReport(reportPath: string): Promise<PlaywrightReportSummary> {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
    const specs = collectPlaywrightSpecs(report);
    const assertions = specs.map((spec, index) => {
      const status = normalizePlaywrightStatus(spec.status);
      return {
        name: spec.title ?? `Playwright test ${index + 1}`,
        status,
        ...(spec.error !== undefined ? { message: spec.error } : {}),
      };
    });
    const total = assertions.length;
    const passed = assertions.filter((assertion) => assertion.status === 'passed').length;
    const failed = assertions.filter((assertion) => assertion.status === 'failed').length;
    const skipped = assertions.filter((assertion) => assertion.status === 'skipped').length;
    const errors = assertions.filter((assertion) => assertion.status === 'error').length;
    const durationMs = isRecord(report) && isRecord(report.stats) && typeof report.stats.duration === 'number'
      ? report.stats.duration
      : undefined;
    return {
      total,
      passed,
      failed,
      skipped,
      errors,
      ...(durationMs !== undefined ? { durationMs } : {}),
      assertions,
    };
  } catch (error) {
    return {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 1,
      assertions: [{
        name: 'Playwright JSON report is readable',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

function collectPlaywrightSpecs(value: unknown): readonly { readonly title?: string; readonly status?: string; readonly error?: string }[] {
  const result: { title?: string; status?: string; error?: string }[] = [];
  visitPlaywrightNode(value, result);
  return result;
}

function visitPlaywrightNode(value: unknown, result: { title?: string; status?: string; error?: string }[]): void {
  if (!isRecord(value)) return;
  const specs = value.specs;
  if (Array.isArray(specs)) {
    for (const spec of specs) {
      if (!isRecord(spec)) continue;
      const tests = Array.isArray(spec.tests) ? spec.tests : [];
      for (const testCase of tests) {
        const bestResult = latestPlaywrightResult(testCase);
        result.push({
          ...(typeof spec.title === 'string' ? { title: spec.title } : {}),
          ...(bestResult.status !== undefined ? { status: bestResult.status } : {}),
          ...(bestResult.error !== undefined ? { error: bestResult.error } : {}),
        });
      }
    }
  }
  for (const childKey of ['suites', 'children']) {
    const children = value[childKey];
    if (!Array.isArray(children)) continue;
    for (const child of children) visitPlaywrightNode(child, result);
  }
}

function latestPlaywrightResult(value: unknown): { readonly status?: string; readonly error?: string } {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length === 0) return {};
  const result = value.results[value.results.length - 1];
  if (!isRecord(result)) return {};
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const firstError = errors.find(isRecord);
  const message = firstError !== undefined && typeof firstError.message === 'string' ? firstError.message : undefined;
  return {
    ...(typeof result.status === 'string' ? { status: result.status } : {}),
    ...(message !== undefined ? { error: message } : {}),
  };
}

function normalizePlaywrightStatus(status: string | undefined): ScenarioResult['status'] {
  if (status === 'passed' || status === 'expected') return 'passed';
  if (status === 'skipped') return 'skipped';
  if (status === 'timedOut' || status === 'interrupted') return 'error';
  if (status === 'failed' || status === 'unexpected') return 'failed';
  return 'error';
}

function summarizePlaywrightExecution(execution: {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}, reportPath: string, report: PlaywrightReportSummary): readonly string[] {
  if (execution.timedOut) return ['Playwright execution timed out.'];
  const diagnostics = [`Playwright exited with code ${execution.exitCode ?? 'unknown'}.`];
  if (report.total > 0) diagnostics.push(`Playwright report: ${report.passed}/${report.total} passed.`);
  if (execution.stderr.trim().length > 0) diagnostics.push(firstUsefulLine(execution.stderr));
  if (execution.stdout.trim().length > 0) diagnostics.push(firstUsefulLine(execution.stdout));
  diagnostics.push(`JSON report: ${reportPath}`);
  return diagnostics;
}

function firstUsefulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? value.trim().slice(0, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number');
}
