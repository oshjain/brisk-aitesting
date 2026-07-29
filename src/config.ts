import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BriskAiTestingConfig } from './types.js';
import { createAiProviderFromConfig } from './providers.js';

export type UserConfig = Partial<BriskAiTestingConfig> & {
  readonly app: BriskAiTestingConfig['app'];
};

export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

export function defineConfigFromHost<THostConfig>(
  hostConfig: THostConfig,
  mapper: (hostConfig: THostConfig) => UserConfig,
): UserConfig {
  return mapper(hostConfig);
}

export function mergeConfig(base: UserConfig, override: Partial<UserConfig>): UserConfig {
  return {
    ...base,
    ...override,
    app: { ...base.app, ...override.app },
    ...(base.auth !== undefined || override.auth !== undefined ? { auth: override.auth ?? base.auth } : {}),
    ...(base.ai !== undefined || override.ai !== undefined ? { ai: { ...base.ai, ...override.ai } as NonNullable<UserConfig['ai']> } : {}),
    ...(base.planning !== undefined || override.planning !== undefined ? { planning: { ...base.planning, ...override.planning } as NonNullable<UserConfig['planning']> } : {}),
    ...(base.contracts !== undefined || override.contracts !== undefined ? { contracts: { ...base.contracts, ...override.contracts } } : {}),
    ...(base.runtime !== undefined || override.runtime !== undefined ? { runtime: { ...base.runtime, ...override.runtime } as NonNullable<UserConfig['runtime']> } : {}),
    ...(base.discovery !== undefined || override.discovery !== undefined ? { discovery: { ...base.discovery, ...override.discovery } as NonNullable<UserConfig['discovery']> } : {}),
    ...(base.security !== undefined || override.security !== undefined ? { security: { ...base.security, ...override.security } as NonNullable<UserConfig['security']> } : {}),
  };
}

export async function loadConfig(configPath = 'brisk-aitesting.config.mjs'): Promise<BriskAiTestingConfig> {
  const absolute = resolve(process.cwd(), configPath);
  const extension = extname(absolute).toLowerCase();
  if (extension === '.json' || extension === '.yaml' || extension === '.yml') {
    const raw = await readFile(absolute, 'utf8');
    const parsed = extension === '.json' ? JSON.parse(raw) as unknown : parseYaml(raw) as unknown;
    return normalizeConfig(assertUserConfig(parsed, absolute));
  }
  const imported = await import(pathToFileURL(absolute).href) as { default?: UserConfig; config?: UserConfig };
  const config = imported.default ?? imported.config;
  if (config === undefined) {
    throw new Error(`No default config export found in ${absolute}`);
  }
  return normalizeConfig(config);
}

function assertUserConfig(value: unknown, path: string): UserConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Config ${path} must be an object.`);
  }
  const config = value as Partial<UserConfig>;
  if (config.app === undefined) {
    throw new Error(`Config ${path} must include app.name and app.baseUrl.`);
  }
  return config as UserConfig;
}

export function normalizeConfig(input: UserConfig): BriskAiTestingConfig {
  if (input.app.name.trim().length === 0) throw new Error('app.name is required');
  if (input.app.baseUrl.trim().length === 0) throw new Error('app.baseUrl is required');
  validateAiConfig(input.ai);
  validatePlanningConfig(input.planning);

  const artifactsDir = input.runtime?.artifactsDir ?? '.brisk-aitesting/artifacts';
  const timeoutMs = input.runtime?.timeoutMs ?? 120_000;
  const retries = input.runtime?.retries ?? 1;

  return {
    app: {
      name: input.app.name,
      baseUrl: input.app.baseUrl.replace(/\/+$/, ''),
      ...(input.app.repoPath !== undefined ? { repoPath: input.app.repoPath } : {}),
      ...(input.app.env !== undefined ? { env: input.app.env } : {}),
    },
    auth: input.auth ?? { type: 'none' },
    ...(input.ai !== undefined ? { ai: input.ai } : {}),
    ...(input.planning !== undefined ? { planning: input.planning } : {}),
    ...(input.contracts !== undefined ? { contracts: input.contracts } : {}),
    runtime: {
      artifactsDir,
      timeoutMs,
      retries,
      headless: input.runtime?.headless ?? true,
      dryRun: input.runtime?.dryRun ?? false,
    },
    discovery: {
      includeRepo: input.discovery?.includeRepo ?? true,
      includeUi: input.discovery?.includeUi ?? true,
      includeApi: input.discovery?.includeApi ?? true,
      includeContracts: input.discovery?.includeContracts ?? true,
    },
    security: {
      networkPolicy: input.security?.networkPolicy ?? 'localhost-only',
      allowedHosts: input.security?.allowedHosts ?? ['localhost', '127.0.0.1', '::1'],
      redactSecrets: input.security?.redactSecrets ?? true,
      strictMode: input.security?.strictMode ?? true,
      allowFallbackTargets: input.security?.allowFallbackTargets ?? false,
      allowAiTargets: input.security?.allowAiTargets ?? false,
      allowHeuristicWorkflowCapture: input.security?.allowHeuristicWorkflowCapture ?? false,
      uiHealing: input.security?.uiHealing ?? 'safe',
    },
    ...(input.engines !== undefined ? { engines: input.engines } : {}),
    ...(input.discoverer !== undefined ? { discoverer: input.discoverer } : {}),
    ...(input.validator !== undefined ? { validator: input.validator } : {}),
    ...(input.aiProvider !== undefined ? { aiProvider: input.aiProvider } : input.ai !== undefined ? { aiProvider: createAiProviderFromConfig(input.ai) } : {}),
  };
}

function validateAiConfig(ai: UserConfig['ai']): void {
  if (ai === undefined) return;
  if (ai.apiKeyEnv !== undefined) {
    if (/^(sk-|Bearer\s+)/i.test(ai.apiKeyEnv) || !/^[A-Z_][A-Z0-9_]*$/.test(ai.apiKeyEnv)) {
      throw new Error('ai.apiKeyEnv must be an environment variable name such as BRISK_AITESTING_AI_API_KEY, not the API key value.');
    }
  }
  if (ai.model.trim().length === 0) {
    throw new Error('ai.model is required when ai config is provided.');
  }
  if (ai.repairAttempts !== undefined && (!Number.isFinite(ai.repairAttempts) || ai.repairAttempts < 0 || ai.repairAttempts > 5)) {
    throw new Error('ai.repairAttempts must be a number between 0 and 5.');
  }
}

function validatePlanningConfig(planning: UserConfig['planning']): void {
  if (planning === undefined) return;
  if (planning.repairAttempts !== undefined && (!Number.isFinite(planning.repairAttempts) || planning.repairAttempts < 0 || planning.repairAttempts > 5)) {
    throw new Error('planning.repairAttempts must be a number between 0 and 5.');
  }
}
