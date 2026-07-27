import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { UiGroundingEvidence, UiRouteGrounder, UiRouteGrounderContext, UiRouteGrounderResult } from '../types.js';
import { browserGroundingFunctionSource, firstUsefulLine, playwrightConfigSource, removePath, resolvePlaywrightCli, runProcess, toPlaywrightPath } from './shared.js';
export class BuiltinPlaywrightRouteGrounder implements UiRouteGrounder {
  readonly name = 'builtin-playwright-route-grounder';

  async ground(context: UiRouteGrounderContext): Promise<UiRouteGrounderResult> {
    const artifactsRoot = resolve(context.config.runtime.artifactsDir);
    const repoRoot = resolve(context.config.app.repoPath ?? process.cwd());
    const dir = join(artifactsRoot, context.runId, 'grounding');
    const workDir = join(repoRoot, 'brisk-aitesting-playwright-work', context.runId, `${context.scenario.id}-grounding`);
    await removePath(workDir);
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
    await removePath(workDir);
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


