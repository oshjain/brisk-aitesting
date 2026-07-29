import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ArtifactRef, Engine, EngineContext, EngineRunResult, ScenarioPlan } from '../types.js';
import { browserGroundingFunctionSource, collectPlaywrightArtifacts, parsePlaywrightReport, playwrightConfigSource, playwrightLocatorFunctionSource, readUiGroundingSummary, removePath, resolvePlaywrightCli, runProcess, scenarioEvidence, scenarioResult, summarizePlaywrightExecution, toPlaywrightPath } from './shared.js';
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
    await removePath(workDir);
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
    const healingEvidencePath = join(dir, `${context.scenario.id}.ui-healing.json`);
    const route = context.scenario.target?.route ?? '/';
    const targetUrl = new URL(route, context.config.app.baseUrl).toString();
    const uiActions = context.scenario.uiActions ?? [];
    const healingPolicy = context.config.security.uiHealing ?? 'safe';
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
      `  const healingEvents = [];`,
      `  const healingPolicy = ${JSON.stringify(healingPolicy)};`,
      `  const actions = ${JSON.stringify(uiActions)};`,
      `  for (const action of actions) {`,
      `    let evidence = grounding.elements.find((element) => element.id === action.evidenceId);`,
      `    let locator;`,
      `    try {`,
      `      if (!evidence) throw new Error('Grounded UI action references missing evidenceId ' + action.evidenceId);`,
      `      if (!isCompatibleEvidence(action, evidence)) throw new Error('Grounded UI action ' + action.action + ' references incompatible evidenceId ' + action.evidenceId + ' (' + (evidence.role || evidence.tagName || evidence.kind || 'unknown') + ')');`,
      `      locator = (${playwrightLocatorFunctionSource()})(page, evidence);`,
      `      await locator.first().waitFor({ state: 'visible', timeout: 5000 });`,
      `    } catch (firstError) {`,
      `      const freshGrounding = await page.evaluate(${browserGroundingFunctionSource()}, ${JSON.stringify({
        scenario: {
          id: context.scenario.id,
          name: context.scenario.name,
          objective: context.scenario.objective,
        },
        route,
        url: targetUrl,
      })});`,
      `      if (healingPolicy === 'off' || isSensitiveAction(action, evidence)) throw firstError;`,
      `      const healedEvidence = findHealingCandidate(action, evidence, freshGrounding.elements, healingPolicy);`,
      `      if (!healedEvidence) throw firstError;`,
      `      locator = (${playwrightLocatorFunctionSource()})(page, healedEvidence);`,
      `      await locator.first().waitFor({ state: 'visible', timeout: 5000 });`,
      `      healingEvents.push({ schemaVersion: 'brisk-aitesting.ui-healing-event.v1', action: action.action, evidenceId: action.evidenceId, reason: String(firstError && firstError.message ? firstError.message : firstError), before: evidence ?? null, after: healedEvidence });`,
      `      evidence = healedEvidence;`,
      `    }`,
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
      `  writeFileSync(${JSON.stringify(healingEvidencePath)}, JSON.stringify({ schemaVersion: 'brisk-aitesting.ui-healing.v1', scenario: ${JSON.stringify(scenarioEvidence(context))}, events: healingEvents }, null, 2) + '\\n', 'utf8');`,
      '});',
      '',
      'function isCompatibleEvidence(action, element) {',
      '  if (!element) return false;',
      '  const role = String(element.role || "").toLowerCase();',
      '  const tag = String(element.tagName || "").toLowerCase();',
      '  const inputType = String(element.inputType || "").toLowerCase();',
      '  const editable = tag === "textarea" || tag === "select" || role === "textbox" || role === "combobox" || element.contentEditable === true || (tag === "input" && !["button", "submit", "checkbox", "radio", "hidden"].includes(inputType));',
      '  const clickable = ["button", "link", "checkbox", "radio", "menuitem", "tab"].includes(role) || ["button", "a"].includes(tag) || element.testId || element.css;',
      '  if (action.action === "fill" || action.action === "select") return editable;',
      '  if (action.action === "check") return role === "checkbox" || tag === "input";',
      '  if (action.action === "click") return Boolean(clickable);',
      '  if (action.action === "press") return editable || clickable;',
      '  if (action.action === "assertText") return true;',
      '  return false;',
      '}',
      '',
      'function isSensitiveAction(action, element) {',
      '  if (action.action !== "click") return false;',
      '  const text = String([action.description, action.text, action.value, element?.text, element?.label, element?.testId, element?.locator?.value].filter(Boolean).join(" ")).toLowerCase();',
      '  return /delete|remove|destroy|drop|disable|revoke|reset|admin|production|billing|payment|submit|confirm|publish|send/.test(text);',
      '}',
      '',
      'function findHealingCandidate(action, previous, elements, healingPolicy) {',
      '  const actionable = elements.filter((element) => element.locator && isCompatibleEvidence(action, element) && (element.role || element.label || element.testId || element.text || element.css));',
      '  const preferredKind = action.action === "fill" ? new Set(["testId", "label", "role"]) : new Set(["testId", "role", "text", "label"]);',
      '  const expectedText = String(action.text || action.value || action.description || "").trim().toLowerCase();',
      '  const previousText = String(previous?.text || previous?.label || previous?.testId || previous?.locator?.value || "").trim().toLowerCase();',
      '  if (actionable.length === 0) return undefined;',
      '  const candidates = actionable.map((element) => {',
      '    let score = 0;',
      '    if (isCompatibleEvidence(action, element)) score += 3;',
      '    if (previous && element.id !== previous.id && element.locator?.strategy === previous.locator?.strategy) score += 2;',
      '    if (previous?.role && element.role === previous.role) score += 3;',
      '    if (previous?.tagName && element.tagName === previous.tagName) score += 2;',
      '    if (healingPolicy === "safe" && previous?.role && element.role !== previous.role) score -= 10;',
      '    if (healingPolicy === "safe" && previous?.tagName && element.tagName !== previous.tagName) score -= 10;',
      '    if (preferredKind.has(element.locator?.strategy)) score += 2;',
      '    const haystack = String([element.text, element.label, element.testId, element.locator?.value].filter(Boolean).join(" ")).toLowerCase();',
      '    if (expectedText && haystack.includes(expectedText)) score += 5;',
      '    if (previousText && haystack.includes(previousText)) score += 4;',
      '    return { element, score };',
      '  }).filter((candidate) => candidate.score >= (healingPolicy === "safe" ? 7 : 1)).sort((left, right) => right.score - left.score);',
      '  return candidates[0]?.element;',
      '}',
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
    await removePath(workDir);

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
    const healingArtifact: ArtifactRef = {
      kind: 'json',
      path: healingEvidencePath,
      label: 'UI healing evidence',
      metadata: {
        schemaVersion: 'brisk-aitesting.ui-healing.v1',
        scenarioId: context.scenario.id,
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
      healingArtifact,
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
      healing: {
        schemaVersion: 'brisk-aitesting.ui-healing.v1',
        path: healingEvidencePath,
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


