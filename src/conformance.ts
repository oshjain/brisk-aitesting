import type { ArtifactRef, BriskAiTestingConfig, Engine, EngineRunResult, ScenarioPlan, TestPlan } from './types.js';

export interface EnginePluginConformanceCase {
  readonly engine: Engine;
  readonly validScenario: ScenarioPlan;
  readonly unrelatedScenario: ScenarioPlan;
}

export interface EnginePluginConformanceCheck {
  readonly name: string;
  readonly status: 'passed' | 'failed';
  readonly detail?: string;
}

export interface EnginePluginConformanceEngineReport {
  readonly name: string;
  readonly type: string;
  readonly status: 'passed' | 'failed';
  readonly checks: readonly EnginePluginConformanceCheck[];
  readonly errors: readonly string[];
}

export interface EnginePluginConformanceReport {
  readonly schemaVersion: 'brisk-aitesting.plugin-conformance.v1';
  readonly status: 'passed' | 'failed';
  readonly engines: readonly EnginePluginConformanceEngineReport[];
  readonly errors: readonly string[];
}

export async function runEnginePluginConformance(params: {
  readonly config: BriskAiTestingConfig;
  readonly plan: TestPlan;
  readonly cases: readonly EnginePluginConformanceCase[];
  readonly runId?: string;
}): Promise<EnginePluginConformanceReport> {
  const engines = [];
  const errors = [];

  for (const engineCase of params.cases) {
    const report = await checkEngine({
      config: params.config,
      plan: params.plan,
      runId: params.runId ?? 'plugin_conformance',
      engine: engineCase.engine,
      validScenario: engineCase.validScenario,
      unrelatedScenario: engineCase.unrelatedScenario,
    });
    engines.push(report);
    errors.push(...report.errors.map((error) => `${engineCase.engine.name}: ${error}`));
  }

  return {
    schemaVersion: 'brisk-aitesting.plugin-conformance.v1',
    status: errors.length === 0 ? 'passed' : 'failed',
    engines,
    errors,
  };
}

async function checkEngine(params: {
  readonly config: BriskAiTestingConfig;
  readonly plan: TestPlan;
  readonly runId: string;
  readonly engine: Engine;
  readonly validScenario: ScenarioPlan;
  readonly unrelatedScenario: ScenarioPlan;
}): Promise<EnginePluginConformanceEngineReport> {
  const checks: EnginePluginConformanceCheck[] = [];
  const errors: string[] = [];
  const record = (name: string, passed: boolean, detail?: string): void => {
    const check = detail === undefined
      ? { name, status: passed ? 'passed' as const : 'failed' as const }
      : { name, status: passed ? 'passed' as const : 'failed' as const, detail };
    checks.push(check);
    if (!passed) errors.push(detail === undefined ? name : `${name}: ${detail}`);
  };

  record('name is non-empty', typeof params.engine.name === 'string' && params.engine.name.trim().length > 0);
  record('type is valid', ['ui', 'api', 'contract', 'schema', 'replay', 'custom'].includes(params.engine.type));
  record('canRun accepts own scenario', params.engine.canRun(params.validScenario) === true);
  record('canRun rejects unrelated scenario', params.engine.canRun(params.unrelatedScenario) === false);

  let output: EngineRunResult | undefined;
  try {
    output = await runWithTimeout(params.engine.run({
      config: params.config,
      runId: params.runId,
      plan: params.plan,
      scenario: params.validScenario,
    }), params.config.runtime.timeoutMs);
    record('run returns output object', isRecord(output));
  } catch (error) {
    record('run returns output object', false, error instanceof Error ? error.message : String(error));
  }

  if (output !== undefined) validateEngineOutput(output, params.validScenario, record);

  return {
    name: params.engine.name,
    type: params.engine.type,
    status: errors.length === 0 ? 'passed' : 'failed',
    checks,
    errors,
  };
}

async function runWithTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Engine exceeded runtime timeout of ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateEngineOutput(
  output: EngineRunResult,
  scenario: ScenarioPlan,
  record: (name: string, passed: boolean, detail?: string) => void,
): void {
  const result = output.result;
  record('result exists', isRecord(result));
  if (!isRecord(result)) return;

  record('result.scenarioId matches scenario', result.scenarioId === scenario.id);
  record('result.name is non-empty', typeof result.name === 'string' && result.name.trim().length > 0);
  record('result.type matches scenario', result.type === scenario.type);
  record('result.engine is non-empty', typeof result.engine === 'string' && result.engine.trim().length > 0);
  record('result.status is valid', ['passed', 'failed', 'error', 'skipped'].includes(result.status as string));
  record('valid scenario passes', result.status === 'passed', String(result.status));
  record('result.durationMs is a finite number', typeof result.durationMs === 'number' && Number.isFinite(result.durationMs));
  record('result.assertions is an array', Array.isArray(result.assertions));
  record('result.artifacts is an array', Array.isArray(result.artifacts));
  record('result.diagnostics is an array', Array.isArray(result.diagnostics));
  record('result has no obvious secret leakage', !containsSecretLikeValue(result));

  if (Array.isArray(result.assertions)) {
    for (const [index, assertion] of result.assertions.entries()) {
      record(`assertion ${index + 1} shape is valid`, isValidAssertion(assertion), JSON.stringify(assertion));
    }
  }

  if (Array.isArray(result.artifacts)) {
    for (const [index, artifact] of result.artifacts.entries()) {
      record(`artifact ${index + 1} shape is valid`, isValidArtifact(artifact), JSON.stringify(artifact));
    }
  }

  if (output.artifacts !== undefined) {
    record('output.artifacts is an array when provided', Array.isArray(output.artifacts));
    if (Array.isArray(output.artifacts)) {
      record('output artifacts have no obvious secret leakage', !containsSecretLikeValue(output.artifacts));
      for (const [index, artifact] of output.artifacts.entries()) {
        record(`output artifact ${index + 1} shape is valid`, isValidArtifact(artifact), JSON.stringify(artifact));
      }
    }
  }
}

function isValidAssertion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string'
    && ['passed', 'failed', 'error', 'skipped'].includes(String(value.status))
    && (value.message === undefined || typeof value.message === 'string');
}

function isValidArtifact(value: unknown): value is ArtifactRef {
  if (!isRecord(value)) return false;
  return ['json', 'junit', 'html', 'trace', 'screenshot', 'video', 'test-file', 'log', 'other'].includes(String(value.kind))
    && (value.path === undefined || typeof value.path === 'string')
    && (value.url === undefined || typeof value.url === 'string')
    && typeof value.label === 'string'
    && value.label.trim().length > 0
    && (value.metadata === undefined || isRecord(value.metadata));
}

function containsSecretLikeValue(value: unknown): boolean {
  return /sk-[A-Za-z0-9]{12,}|npm_[A-Za-z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|AKIA[A-Z0-9]{12,}/i.test(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
