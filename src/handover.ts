import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRef, BriskAiTestingConfig, BriskAiTestingResult, HandoverEnvelope, ScenarioResult, TestPlan } from './types.js';

export function buildResult(params: {
  readonly config: BriskAiTestingConfig;
  readonly goal: string;
  readonly runId: string;
  readonly plan: TestPlan;
  readonly discovery: BriskAiTestingResult['discovery'];
  readonly startedAt: number;
  readonly tests: readonly ScenarioResult[];
  readonly artifacts: readonly ArtifactRef[];
}): BriskAiTestingResult {
  const summary = summarize(params.tests, Date.now() - params.startedAt);
  const status = summary.errors > 0 ? 'error' : summary.failed > 0 ? 'failed' : summary.passed > 0 ? 'passed' : 'skipped';

  return {
    schemaVersion: 'brisk-aitesting.result.v1',
    runId: params.runId,
    status,
    app: {
      name: params.config.app.name,
      baseUrl: params.config.app.baseUrl,
      ...(params.config.app.env !== undefined ? { env: params.config.app.env } : {}),
    },
    goal: params.goal,
    discovery: params.discovery,
    plan: params.plan,
    summary,
    tests: params.tests,
    artifacts: params.artifacts,
    diagnosis: params.tests
      .filter((test) => test.status === 'failed' || test.status === 'error')
      .map((test) => ({
        scenarioId: test.scenarioId,
        reason: test.diagnostics.join('; ') || `${test.name} did not pass`,
        suggestedFixes: ['Check the generated artifact, app availability, configured auth, and engine-specific diagnostics.'],
      })),
    handover: buildHandover(params.config, params.runId),
  };
}

export async function persistResult(config: BriskAiTestingConfig, result: BriskAiTestingResult): Promise<ArtifactRef> {
  const dir = join(config.runtime.artifactsDir, result.runId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'result.json');
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { kind: 'json', path, label: 'Result JSON' };
}

function summarize(tests: readonly ScenarioResult[], durationMs: number): BriskAiTestingResult['summary'] {
  const total = tests.length;
  const passed = tests.filter((test) => test.status === 'passed').length;
  const failed = tests.filter((test) => test.status === 'failed').length;
  const skipped = tests.filter((test) => test.status === 'skipped').length;
  const errors = tests.filter((test) => test.status === 'error').length;
  return {
    total,
    passed,
    failed,
    skipped,
    errors,
    passRate: total === 0 ? 0 : Math.round((passed / total) * 10000) / 100,
    durationMs,
  };
}

function buildHandover(config: BriskAiTestingConfig, runId: string): HandoverEnvelope {
  return {
    schemaVersion: 'brisk-aitesting.handover.v1',
    generatedAt: new Date().toISOString(),
    resultSchema: 'brisk-aitesting.result.v1',
    storage: {
      required: false,
      recommendedKeys: ['runId', 'status', 'summary', 'tests', 'artifacts', 'diagnosis', 'handover'],
      artifactRoot: join(config.runtime.artifactsDir, runId),
    },
    consumers: {
      database: 'store result JSON as-is or split summary/tests/artifacts',
      ci: 'use status, summary, artifacts, and junit/html outputs',
      dashboard: 'render summary, tests, artifacts, and diagnosis',
    },
  };
}
