#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBriskAiTesting } from './orchestrator.js';
import { loadConfig } from './config.js';
import { loadEnvFiles } from './env.js';
import { loadOpenApiSummary } from './openapi.js';
import { removePath } from './engines/shared.js';
import type { BriskAiTestingResult, EngineType } from './types.js';

class UsageError extends Error {}

const [, , command, ...args] = process.argv;

try {
  let exitCode = 0;
  if (command === 'init') {
    await init(args);
  } else if (command === 'run') {
    exitCode = await run(args);
  } else if (command === 'clean') {
    await clean(args);
  } else if (command === 'inspect') {
    await inspect(args);
  } else if (command === 'doctor') {
    exitCode = await doctor(args);
  } else if (command === '--help' || command === '-h' || command === 'help') {
    help();
  } else {
    help();
    exitCode = command === undefined ? 0 : 2;
  }
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`brisk-aitesting: ${message}`);
  process.exit(error instanceof UsageError ? 2 : 2);
}

async function init(args: readonly string[]): Promise<void> {
  const options = parseInitArgs(args);
  const configPath = options.configPath;
  if (existsSync(configPath)) {
    console.log(`${configPath} already exists`);
    return;
  }

  await mkdir('.brisk-aitesting/artifacts', { recursive: true });
  await writeFile(configPath, starterConfig(options), 'utf8');
  console.log(`Created ${configPath}`);
  console.log('Next: brisk-aitesting run --goal "Test login, dashboard, APIs, and permissions"');
}

async function run(args: readonly string[]): Promise<number> {
  const options = parseRunArgs(args);
  const goal = options.goal;
  if (goal.length === 0) throw new UsageError('Please provide a test goal with --goal "<what to test>" or a positional goal.');

  await loadEnvFiles();
  const config = await loadConfig(options.configPath);
  const tester = createBriskAiTesting(config);
  if (!options.quiet && !options.json) {
    tester.onEvent((event) => {
      if (event.type === 'run.started') console.log(`Run started: ${event.runId}`);
      if (event.type === 'discovery.completed') console.log(`Discovery: ${event.discovery.uiRoutes.length} UI routes, ${event.discovery.apiRoutes.length} API routes, ${event.discovery.contracts.length} contracts`);
      if (event.type === 'plan.created') console.log(`Plan: ${event.plan.scenarios.length} scenarios`);
      if (event.type === 'plan.repair.started') console.log(`Repairing plan: attempt ${event.attempt}`);
      if (event.type === 'scenario.started') console.log(`- ${event.scenario.name}`);
      if (event.type === 'scenario.completed') console.log(`  ${event.result.status.toUpperCase()} via ${event.result.engine}`);
    });
  }

  const result = await tester.run({
    goal,
    scenarios: options.scenarios,
    mode: options.mode,
    ...(options.requiredTypes.length > 0 ? { requiredTypes: options.requiredTypes } : {}),
    ...(options.uiActionFeedback !== undefined ? { uiActionFeedback: options.uiActionFeedback } : {}),
  });
  if (options.outputPath !== undefined) await writeResult(options.outputPath, result);
  if (options.json) {
    console.log(JSON.stringify(cliResult(result, options.outputPath), null, 2));
  } else if (!options.quiet) {
    printHumanSummary(result, options.outputPath);
  }
  return result.status === 'passed' ? 0 : 1;
}

function help(): void {
  console.log([
    'brisk-aitesting',
    '',
    'Commands:',
    '  init                         create brisk-aitesting.config.mjs',
    '  run --goal "<goal>"          plan and run automated tests',
    '  inspect --result <path>      explain a saved result JSON',
    '  doctor                       check local setup and explain what is missing',
    '  clean                        remove Brisk-generated local artifacts',
    '',
    'Options for run:',
    '  --config <path>              config file path',
    '  --goal <text>                test goal; positional goal is also supported',
    '  --scenarios <number>         number of scenarios to plan',
    '  --mode <automatic|ui|api|contract|schema|replay|message|custom>',
    '  --required-type <type>       require a scenario type; can be repeated',
    '  --ui-action-feedback <off|when-missing|always>',
    '  --json                       print machine-readable run summary',
    '  --output <path>              write final result JSON to this path',
    '  --quiet                      suppress progress and human summary',
    '',
    'Options for init:',
    '  --config <path>              config file path to create',
    '  --base-url <url>             app URL to test',
    '  --app-name <name>            app name',
    '',
    'Options for clean:',
    '  --artifacts-dir <path>       remove this artifact directory instead of .brisk-aitesting',
    '  --include-playwright-output  also remove test-results and playwright-report',
    '  --dry-run                    show what would be removed without deleting',
    '  --json                       print machine-readable cleanup summary',
    '',
    'Options for inspect:',
    '  --result <path>              path to result.json or a CLI --output file',
    '  --json                       print machine-readable inspection',
    '',
    'Example:',
    '  brisk-aitesting run --goal "Test login, billing, API contracts, and permissions" --scenarios 15',
  ].join('\n'));
}

async function doctor(args: readonly string[]): Promise<number> {
  const options = parseDoctorArgs(args);
  await loadEnvFiles();
  const checks = await runDoctorChecks(options.configPath);
  const failed = checks.filter((check) => check.status === 'failed');
  const warning = checks.filter((check) => check.status === 'warning');
  const summary = {
    schemaVersion: 'brisk-aitesting.doctor-result.v1',
    status: failed.length > 0 ? 'failed' : warning.length > 0 ? 'warning' : 'passed',
    checks,
  };
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of checks) {
      console.log(`${check.status.toUpperCase()}: ${check.name} - ${check.message}`);
    }
  }
  return failed.length > 0 ? 1 : 0;
}

async function runDoctorChecks(configPath: string): Promise<readonly {
  readonly name: string;
  readonly status: 'passed' | 'warning' | 'failed';
  readonly message: string;
}[]> {
  const checks: {
    readonly name: string;
    readonly status: 'passed' | 'warning' | 'failed';
    readonly message: string;
  }[] = [];
  checks.push({
    name: 'Node.js',
    status: Number(process.versions.node.split('.')[0] ?? 0) >= 20 ? 'passed' : 'failed',
    message: `Detected ${process.version}; Node.js 20 or newer is required.`,
  });
  checks.push({
    name: 'Config file',
    status: existsSync(configPath) ? 'passed' : 'warning',
    message: existsSync(configPath) ? `Found ${configPath}.` : `No ${configPath}; run brisk-aitesting init or pass --config.`,
  });
  try {
    const config = existsSync(configPath) ? await loadConfig(configPath) : undefined;
    checks.push({
      name: 'Base URL',
      status: config === undefined || config.app.baseUrl.startsWith('http') ? 'passed' : 'failed',
      message: config === undefined ? 'Skipped because config is missing.' : `Configured app.baseUrl is ${config.app.baseUrl}.`,
    });
    if (config !== undefined) {
      checks.push(await urlReachabilityCheck(config.app.baseUrl, 'App reachability'));
    }
    checks.push({
      name: 'AI provider',
      status: config?.ai === undefined ? 'passed' : resolveConfiguredApiKey(config.ai.apiKey, config.ai.apiKeyEnv) ? 'passed' : 'failed',
      message: config?.ai === undefined ? 'No remote AI provider configured; deterministic planning can still run.' : `Provider ${config.ai.provider} uses model ${config.ai.model}.`,
    });
    if (config?.contracts?.openApiPath !== undefined) {
      checks.push(await openApiContractCheck(config.contracts.openApiPath));
    }
    if (config?.auth.type === 'credentials' && config.auth.loginUrl !== undefined) {
      checks.push(await urlReachabilityCheck(new URL(config.auth.loginUrl, config.app.baseUrl).toString(), 'Login reachability'));
    } else if (config?.auth.type === 'credentials') {
      checks.push({
        name: 'Auth setup',
        status: 'warning',
        message: 'Credentials are configured, but auth.loginUrl is missing, so browser login readiness cannot be checked.',
      });
    }
    checks.push({
      name: 'Security mode',
      status: config?.security.networkPolicy === 'open' ? 'warning' : 'passed',
      message: config === undefined ? 'Skipped because config is missing.' : `Network policy is ${config.security.networkPolicy}; strict mode is ${config.security.strictMode === false ? 'off' : 'on'}.`,
    });
  } catch (error) {
    checks.push({
      name: 'Config load',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  checks.push(playwrightCheck());
  checks.push(playwrightBrowserCheck());
  checks.push(javaRuntimeCheck());
  checks.push(specmaticRuntimeCheck());
  return checks;
}

async function urlReachabilityCheck(url: string, name: string): Promise<{ readonly name: string; readonly status: 'passed' | 'warning' | 'failed'; readonly message: string }> {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return {
      name,
      status: response.status < 500 ? 'passed' : 'warning',
      message: `${url} responded with HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      name,
      status: 'warning',
      message: `${url} could not be reached from this machine: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function openApiContractCheck(path: string): Promise<{ readonly name: string; readonly status: 'passed' | 'warning' | 'failed'; readonly message: string }> {
  try {
    const summary = await loadOpenApiSummary(path);
    return {
      name: 'OpenAPI contract',
      status: summary.operations.length > 0 ? 'passed' : 'warning',
      message: `${path} exposes ${summary.operations.length} operation(s).${summary.diagnostics.length > 0 ? ` ${summary.diagnostics.join(' ')}` : ''}`,
    };
  } catch (error) {
    return {
      name: 'OpenAPI contract',
      status: 'failed',
      message: `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function playwrightCheck(): { readonly name: string; readonly status: 'passed' | 'warning' | 'failed'; readonly message: string } {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve('@playwright/test/package.json');
    return { name: 'Playwright', status: 'passed', message: `Found @playwright/test at ${path}.` };
  } catch {
    return { name: 'Playwright', status: 'warning', message: 'UI tests need @playwright/test installed by the host app.' };
  }
}

function playwrightBrowserCheck(): { readonly name: string; readonly status: 'passed' | 'warning' | 'failed'; readonly message: string } {
  const result = spawnSync(process.execPath, ['-e', "import('@playwright/test').then(async ({ chromium }) => { const browser = await chromium.launch({ headless: true }); await browser.close(); }).catch((error) => { console.error(error.message); process.exit(1); })"], { encoding: 'utf8' });
  if (result.status === 0) return { name: 'Playwright browser', status: 'passed', message: 'Chromium can launch locally.' };
  const detail = (result.stderr || result.stdout || '').trim();
  return { name: 'Playwright browser', status: 'warning', message: `UI tests may need browser binaries installed. ${detail || 'Run the host app Playwright install command.'}` };
}

function javaRuntimeCheck(): { readonly name: string; readonly status: 'passed' | 'warning' | 'failed'; readonly message: string } {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (result.status === 0) return { name: 'Java runtime', status: 'passed', message: 'Java is available for optional JVM-based contract adapters.' };
  return { name: 'Java runtime', status: 'warning', message: 'Java is not available. Optional JVM-based adapters will not run on this machine.' };
}

function specmaticRuntimeCheck(): { readonly name: string; readonly status: 'passed' | 'warning' | 'failed'; readonly message: string } {
  try {
    const require = createRequire(import.meta.url);
    const path = require.resolve('specmatic/package.json');
    return { name: 'Specmatic adapter runtime', status: 'passed', message: `Found optional specmatic package at ${path}.` };
  } catch {
    return { name: 'Specmatic adapter runtime', status: 'warning', message: 'Optional Specmatic adapter package is not installed in this project.' };
  }
}

function resolveConfiguredApiKey(apiKey: string | undefined, apiKeyEnv: string | undefined): boolean {
  if (apiKey !== undefined && apiKey.length > 0) return true;
  if (apiKeyEnv !== undefined && (process.env[apiKeyEnv] ?? '').length > 0) return true;
  return (process.env.BRISK_AITESTING_AI_API_KEY ?? '').length > 0;
}

async function clean(args: readonly string[]): Promise<void> {
  const options = parseCleanArgs(args);
  const targets = [
    options.artifactsDir,
    '.brisk-aitesting-benchmark',
    '.brisk-aitesting-cli-smoke',
    '.brisk-aitesting-engine-conformance',
    '.brisk-aitesting-fixtures',
    '.brisk-aitesting-pack-check',
    '.brisk-aitesting-plugin-conformance',
    '.brisk-aitesting-real-ai',
    '.brisk-aitesting-reference-serious-saas',
    '.brisk-aitesting-smoke',
    'brisk-aitesting-playwright-work',
    ...(options.includePlaywrightOutput ? ['test-results', 'playwright-report'] : []),
  ];
  const absoluteTargets = [...new Set(targets.map((target) => resolve(process.cwd(), target)))];
  const existedBefore = new Map(absoluteTargets.map((target) => [target, existsSync(target)]));
  const existingTargets = absoluteTargets.filter((target) => existedBefore.get(target) === true);

  if (!options.dryRun) {
    for (const target of absoluteTargets) {
      await removePath(target);
    }
  }

  const summary = {
    schemaVersion: 'brisk-aitesting.clean-result.v1',
    dryRun: options.dryRun,
    removed: options.dryRun ? 0 : existingTargets.length,
    targets: absoluteTargets.map((target) => ({
      path: target,
      existed: existedBefore.get(target) === true,
      action: options.dryRun ? 'would-remove' : 'removed',
    })),
  };
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const verb = options.dryRun ? 'Would remove' : 'Removed';
    console.log(`${verb} ${options.dryRun ? existingTargets.length : summary.removed} existing artifact locations.`);
  }
}

async function inspect(args: readonly string[]): Promise<void> {
  const options = parseInspectArgs(args);
  const raw = await readFile(resolve(process.cwd(), options.resultPath), 'utf8');
  const result = JSON.parse(raw) as BriskAiTestingResult;
  const inspection = inspectResult(result);
  if (options.json) {
    console.log(JSON.stringify(inspection, null, 2));
    return;
  }
  console.log(`Run: ${inspection.runId}`);
  console.log(`Status: ${inspection.status}`);
  console.log(`Summary: ${result.summary.passed}/${result.summary.total} passed (${result.summary.passRate}%)`);
  if (inspection.failures.length > 0) {
    console.log('Failures:');
    for (const failure of inspection.failures) {
      console.log(`- ${failure.name}: ${failure.reason}`);
      if (failure.artifacts.length > 0) console.log(`  Evidence: ${failure.artifacts[0]}`);
    }
  }
  if (inspection.captures.length > 0) {
    console.log('Captured values:');
    for (const capture of inspection.captures) console.log(`- ${capture.name} from ${capture.source}`);
  }
  if (inspection.cleanup.length > 0) {
    console.log('Cleanup actions:');
    for (const cleanup of inspection.cleanup) console.log(`- ${cleanup.name}: ${cleanup.status}`);
  }
  if (inspection.healingEvents > 0) console.log(`UI healing events: ${inspection.healingEvents}`);
}

function inspectResult(result: BriskAiTestingResult): {
  readonly schemaVersion: 'brisk-aitesting.inspect-result.v1';
  readonly runId: string;
  readonly status: string;
  readonly summary: BriskAiTestingResult['summary'];
  readonly failures: readonly { readonly scenarioId: string; readonly name: string; readonly type: string; readonly status: string; readonly reason: string; readonly artifacts: readonly string[] }[];
  readonly captures: readonly { readonly name: string; readonly source: string }[];
  readonly cleanup: readonly { readonly name: string; readonly status: string; readonly diagnostics: readonly string[] }[];
  readonly artifactRoot: string;
  readonly artifacts: number;
  readonly healingEvents: number;
} {
  const failures = result.tests
    .filter((test) => test.status === 'failed' || test.status === 'error')
    .map((test) => ({
      scenarioId: test.scenarioId,
      name: test.name,
      type: test.type,
      status: test.status,
      reason: test.diagnostics.join('; ') || test.assertions.find((assertion) => assertion.status === 'failed')?.message || 'No diagnostic was recorded.',
      artifacts: test.artifacts.map((artifact) => artifact.path).filter((path): path is string => typeof path === 'string'),
    }));
  const cleanup = result.tests
    .filter((test) => test.scenarioId.startsWith('cleanup_'))
    .map((test) => ({ name: test.name, status: test.status, diagnostics: test.diagnostics }));
  const captures = extractPlannedCaptures(result);
  const healingEvents = result.artifacts.filter((artifact) => artifact.metadata?.schemaVersion === 'brisk-aitesting.ui-healing.v1').length;
  return {
    schemaVersion: 'brisk-aitesting.inspect-result.v1',
    runId: result.runId,
    status: result.status,
    summary: result.summary,
    failures,
    captures,
    cleanup,
    artifactRoot: result.handover.storage.artifactRoot,
    artifacts: result.artifacts.length,
    healingEvents,
  };
}

function extractPlannedCaptures(result: BriskAiTestingResult): readonly { readonly name: string; readonly source: string }[] {
  const captures = new Map<string, string>();
  for (const scenario of result.plan.scenarios) {
    for (const capture of scenario.capture ?? []) {
      captures.set(capture.name, `${scenario.id} ${capture.from}.${capture.path}`);
    }
  }
  return [...captures.entries()].map(([name, source]) => ({ name, source }));
}

function parseCleanArgs(args: readonly string[]): {
  readonly artifactsDir: string;
  readonly includePlaywrightOutput: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
} {
  let artifactsDir = '.brisk-aitesting';
  let includePlaywrightOutput = false;
  let dryRun = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--include-playwright-output') {
      includePlaywrightOutput = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--artifacts-dir') {
      artifactsDir = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      help();
      process.exit(0);
    } else if (arg?.startsWith('--') === true) {
      throw new UsageError(`Unknown clean option ${arg}.`);
    } else if (arg !== undefined) {
      throw new UsageError(`Unexpected clean argument ${arg}.`);
    }
  }
  return { artifactsDir, includePlaywrightOutput, dryRun, json };
}

function parseInspectArgs(args: readonly string[]): { readonly resultPath: string; readonly json: boolean } {
  let resultPath: string | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--result') {
      resultPath = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help();
      process.exit(0);
    } else if (arg?.startsWith('--') === true) {
      throw new UsageError(`Unknown inspect option ${arg}.`);
    } else if (arg !== undefined && resultPath === undefined) {
      resultPath = arg;
    } else if (arg !== undefined) {
      throw new UsageError(`Unexpected inspect argument ${arg}.`);
    }
  }
  if (resultPath === undefined) throw new UsageError('inspect requires --result <path>.');
  return { resultPath, json };
}

function parseRunArgs(args: readonly string[]): {
  readonly goal: string;
  readonly scenarios: number;
  readonly mode: 'automatic' | EngineType;
  readonly configPath: string;
  readonly requiredTypes: readonly EngineType[];
  readonly uiActionFeedback?: 'off' | 'when-missing' | 'always';
  readonly json: boolean;
  readonly quiet: boolean;
  readonly outputPath?: string;
} {
  const goalParts: string[] = [];
  let scenarios = 5;
  let mode: 'automatic' | EngineType = 'automatic';
  let configPath = 'brisk-aitesting.config.mjs';
  const requiredTypes: EngineType[] = [];
  let uiActionFeedback: 'off' | 'when-missing' | 'always' | undefined;
  let json = false;
  let quiet = false;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scenarios') {
      scenarios = parsePositiveInteger(readOptionValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--mode') {
      mode = parseMode(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--config') {
      configPath = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--goal') {
      goalParts.push(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--required-type') {
      const requiredType = parseMode(readOptionValue(args, index, arg));
      if (requiredType === 'automatic') throw new UsageError('--required-type cannot be automatic.');
      requiredTypes.push(requiredType);
      index += 1;
    } else if (arg === '--ui-action-feedback') {
      uiActionFeedback = parseUiActionFeedback(readOptionValue(args, index, arg));
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--output') {
      outputPath = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      help();
      process.exit(0);
    } else if (arg?.startsWith('--') === true) {
      throw new UsageError(`Unknown option ${arg}.`);
    } else if (arg !== undefined) {
      goalParts.push(arg);
    }
  }

  return {
    goal: goalParts.join(' ').trim(),
    scenarios,
    mode,
    configPath,
    requiredTypes,
    ...(uiActionFeedback !== undefined ? { uiActionFeedback } : {}),
    json,
    quiet,
    ...(outputPath !== undefined ? { outputPath } : {}),
  };
}

function parseInitArgs(args: readonly string[]): {
  readonly configPath: string;
  readonly baseUrl: string;
  readonly appName: string;
} {
  let configPath = 'brisk-aitesting.config.mjs';
  let baseUrl = 'http://localhost:3000';
  let appName = 'My SaaS';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') {
      configPath = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--base-url') {
      baseUrl = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--app-name') {
      appName = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      help();
      process.exit(0);
    } else if (arg?.startsWith('--') === true) {
      throw new UsageError(`Unknown init option ${arg}.`);
    } else if (arg !== undefined) {
      throw new UsageError(`Unexpected init argument ${arg}.`);
    }
  }
  return { configPath, baseUrl, appName };
}

function parseDoctorArgs(args: readonly string[]): { readonly configPath: string; readonly json: boolean } {
  let configPath = 'brisk-aitesting.config.mjs';
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') {
      configPath = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help();
      process.exit(0);
    } else if (arg?.startsWith('--') === true) {
      throw new UsageError(`Unknown doctor option ${arg}.`);
    } else if (arg !== undefined) {
      throw new UsageError(`Unexpected doctor argument ${arg}.`);
    }
  }
  return { configPath, json };
}

function parseMode(value: string | undefined): 'automatic' | EngineType {
  const allowed = ['automatic', 'ui', 'api', 'contract', 'schema', 'replay', 'message', 'custom'] as const;
  if (value !== undefined && allowed.includes(value as typeof allowed[number])) {
    return value as 'automatic' | EngineType;
  }
  throw new Error(`Invalid --mode. Expected one of: ${allowed.join(', ')}`);
}

function parseUiActionFeedback(value: string): 'off' | 'when-missing' | 'always' {
  const allowed = ['off', 'when-missing', 'always'] as const;
  if (allowed.includes(value as typeof allowed[number])) return value as 'off' | 'when-missing' | 'always';
  throw new UsageError(`Invalid --ui-action-feedback. Expected one of: ${allowed.join(', ')}`);
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`${option} must be a positive integer.`);
  return parsed;
}

function readOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${option} requires a value.`);
  return value;
}

async function writeResult(path: string, result: BriskAiTestingResult): Promise<void> {
  const absolute = resolve(process.cwd(), path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function printHumanSummary(result: BriskAiTestingResult, outputPath: string | undefined): void {
  const resultPath = result.artifacts.find((artifact) => artifact.kind === 'json' && artifact.label === 'Result JSON')?.path ?? result.handover.storage.artifactRoot;
  console.log('');
  console.log(`Status: ${result.status}`);
  console.log(`Summary: ${result.summary.passed}/${result.summary.total} passed (${result.summary.passRate}%)`);
  console.log(`Duration: ${Math.round(result.summary.durationMs / 100) / 10}s`);
  console.log(`Result: ${outputPath ?? resultPath}`);
  if (result.diagnosis.length > 0) {
    console.log('Diagnosis:');
    for (const diagnosis of result.diagnosis.slice(0, 5)) {
      console.log(`- ${diagnosis.reason}`);
    }
  }
}

function cliResult(result: BriskAiTestingResult, outputPath: string | undefined): Record<string, unknown> {
  return {
    schemaVersion: 'brisk-aitesting.cli-result.v1',
    runId: result.runId,
    status: result.status,
    summary: result.summary,
    resultPath: outputPath ?? result.artifacts.find((artifact) => artifact.kind === 'json' && artifact.label === 'Result JSON')?.path,
    artifactRoot: result.handover.storage.artifactRoot,
    diagnosis: result.diagnosis,
  };
}

function starterConfig(options: { readonly appName: string; readonly baseUrl: string }): string {
  return `import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: ${JSON.stringify(options.appName)},
    baseUrl: ${JSON.stringify(options.baseUrl)},
    repoPath: '.',
  },
  auth: {
    type: 'none',
  },
});
`;
}
