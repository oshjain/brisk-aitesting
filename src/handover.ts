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

export async function persistCiReports(config: BriskAiTestingConfig, result: BriskAiTestingResult): Promise<readonly ArtifactRef[]> {
  const dir = join(config.runtime.artifactsDir, result.runId);
  await mkdir(dir, { recursive: true });
  const junitPath = join(dir, 'junit.xml');
  const htmlPath = join(dir, 'report.html');
  await writeFile(junitPath, junitReport(result), 'utf8');
  await writeFile(htmlPath, htmlReport(result), 'utf8');
  return [
    {
      kind: 'junit',
      path: junitPath,
      label: 'JUnit report',
      metadata: {
        schemaVersion: 'brisk-aitesting.junit-report.v1',
        runId: result.runId,
      },
    },
    {
      kind: 'html',
      path: htmlPath,
      label: 'HTML report',
      metadata: {
        schemaVersion: 'brisk-aitesting.html-report.v1',
        runId: result.runId,
      },
    },
  ];
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

function junitReport(result: BriskAiTestingResult): string {
  const tests = result.tests;
  const failures = tests.filter((test) => test.status === 'failed').length;
  const errors = tests.filter((test) => test.status === 'error').length;
  const skipped = tests.filter((test) => test.status === 'skipped').length;
  const body = tests.map((test) => {
    const timeSeconds = Math.max(0, test.durationMs / 1000);
    const diagnostics = test.diagnostics.join('\n');
    const assertions = test.assertions.map((assertion) => `${assertion.status.toUpperCase()}: ${assertion.name}${assertion.message !== undefined ? ` - ${assertion.message}` : ''}`).join('\n');
    const details = [diagnostics, assertions].filter((entry) => entry.trim().length > 0).join('\n\n');
    const problem = test.status === 'failed'
      ? `\n    <failure message=${quoteXml(details || 'Test failed')}>${escapeXml(details)}</failure>`
      : test.status === 'error'
        ? `\n    <error message=${quoteXml(details || 'Test errored')}>${escapeXml(details)}</error>`
        : test.status === 'skipped'
          ? '\n    <skipped />'
          : '';
    return `  <testcase classname=${quoteXml(`brisk.${test.type}`)} name=${quoteXml(test.name)} time=${quoteXml(String(timeSeconds))}>${problem}\n  </testcase>`;
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name=${quoteXml(result.app.name)} tests=${quoteXml(String(tests.length))} failures=${quoteXml(String(failures))} errors=${quoteXml(String(errors))} skipped=${quoteXml(String(skipped))} time=${quoteXml(String(Math.max(0, result.summary.durationMs / 1000)))} timestamp=${quoteXml(result.handover.generatedAt)}>`,
    body,
    '</testsuite>',
    '',
  ].join('\n');
}

function htmlReport(result: BriskAiTestingResult): string {
  const rows = result.tests.map((test) => `
        <tr>
          <td>${escapeHtml(test.name)}</td>
          <td>${escapeHtml(test.type)}</td>
          <td><span class="status ${escapeHtml(test.status)}">${escapeHtml(test.status)}</span></td>
          <td>${escapeHtml(test.engine)}</td>
          <td>${Math.round(test.durationMs / 100) / 10}s</td>
          <td>${escapeHtml(test.diagnostics.join('; '))}</td>
        </tr>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>brisk-aitesting report ${escapeHtml(result.runId)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
      h1 { margin-bottom: 4px; }
      .summary { display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap; }
      .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 12px 16px; min-width: 120px; }
      .value { font-size: 24px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th, td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 10px; vertical-align: top; }
      th { background: #f9fafb; }
      .status { border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 700; }
      .passed { background: #dcfce7; color: #166534; }
      .failed { background: #fee2e2; color: #991b1b; }
      .error { background: #ffedd5; color: #9a3412; }
      .skipped { background: #e5e7eb; color: #374151; }
    </style>
  </head>
  <body>
    <h1>brisk-aitesting report</h1>
    <div>${escapeHtml(result.app.name)} · ${escapeHtml(result.runId)}</div>
    <p>${escapeHtml(result.goal)}</p>
    <section class="summary">
      <div class="card"><div>Total</div><div class="value">${result.summary.total}</div></div>
      <div class="card"><div>Passed</div><div class="value">${result.summary.passed}</div></div>
      <div class="card"><div>Failed</div><div class="value">${result.summary.failed}</div></div>
      <div class="card"><div>Skipped</div><div class="value">${result.summary.skipped}</div></div>
      <div class="card"><div>Pass Rate</div><div class="value">${result.summary.passRate}%</div></div>
    </section>
    <table>
      <thead>
        <tr><th>Scenario</th><th>Type</th><th>Status</th><th>Engine</th><th>Duration</th><th>Diagnostics</th></tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </body>
</html>
`;
}

function quoteXml(value: string): string {
  return `"${escapeXml(value)}"`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}
