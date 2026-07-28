#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createBriskAiTesting } from './orchestrator.js';
import { loadConfig } from './config.js';
import { loadEnvFiles } from './env.js';
import { removePath } from './engines/shared.js';
import type { BriskAiTestingResult, EngineType } from './types.js';

class UsageError extends Error {}

const [, , command, ...args] = process.argv;

try {
  let exitCode = 0;
  if (command === 'init') {
    await init();
  } else if (command === 'run') {
    exitCode = await run(args);
  } else if (command === 'clean') {
    await clean(args);
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

async function init(): Promise<void> {
  const configPath = 'brisk-aitesting.config.ts';
  if (existsSync(configPath)) {
    console.log(`${configPath} already exists`);
    return;
  }

  await mkdir('.brisk-aitesting/artifacts', { recursive: true });
  await writeFile(configPath, starterConfig(), 'utf8');
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
    '  init                         create brisk-aitesting.config.ts',
    '  run --goal "<goal>"          plan and run automated tests',
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
    'Options for clean:',
    '  --artifacts-dir <path>       remove this artifact directory instead of .brisk-aitesting',
    '  --include-playwright-output  also remove test-results and playwright-report',
    '  --dry-run                    show what would be removed without deleting',
    '  --json                       print machine-readable cleanup summary',
    '',
    'Example:',
    '  brisk-aitesting run --goal "Test login, billing, API contracts, and permissions" --scenarios 15',
  ].join('\n'));
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
  let configPath = 'brisk-aitesting.config.ts';
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

function starterConfig(): string {
  return `import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: 'My SaaS',
    baseUrl: 'http://localhost:3000',
    repoPath: '.',
    env: 'local',
  },
  auth: {
    type: 'none',
  },
  runtime: {
    artifactsDir: '.brisk-aitesting/artifacts',
    timeoutMs: 120000,
    retries: 1,
    headless: true,
    dryRun: true,
  },
  discovery: {
    includeRepo: true,
    includeUi: true,
    includeApi: true,
    includeContracts: true,
  },
  security: {
    networkPolicy: 'localhost-only',
    allowedHosts: ['localhost', '127.0.0.1', '::1'],
    redactSecrets: true,
  },
});
`;
}
