#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createBriskAiTesting } from './orchestrator.js';
import { loadConfig } from './config.js';
import { loadEnvFiles } from './env.js';
import type { EngineType } from './types.js';

const [, , command, ...args] = process.argv;

try {
  if (command === 'init') {
    await init();
  } else if (command === 'run') {
    await run(args);
  } else {
    help();
    process.exit(command === undefined ? 0 : 1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
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
  console.log('Next: brisk-aitesting run "Test login, dashboard, APIs, and permissions"');
}

async function run(args: readonly string[]): Promise<void> {
  const options = parseRunArgs(args);
  const goal = options.goal;
  if (goal.length === 0) throw new Error('Please provide a test goal.');

  await loadEnvFiles();
  const config = await loadConfig(options.configPath);
  const tester = createBriskAiTesting(config);
  tester.onEvent((event) => {
    if (event.type === 'run.started') console.log(`Run started: ${event.runId}`);
    if (event.type === 'plan.repair.started') console.log(`Repairing plan: attempt ${event.attempt}`);
    if (event.type === 'scenario.started') console.log(`- ${event.scenario.name}`);
    if (event.type === 'scenario.completed') console.log(`  ${event.result.status.toUpperCase()} via ${event.result.engine}`);
  });

  const result = await tester.run({ goal, scenarios: options.scenarios, mode: options.mode });
  console.log('');
  console.log(`Status: ${result.status}`);
  console.log(`Summary: ${result.summary.passed}/${result.summary.total} passed (${result.summary.passRate}%)`);
  console.log(`Result: ${result.artifacts.find((artifact) => artifact.kind === 'json')?.path ?? result.handover.storage.artifactRoot}`);
}

function help(): void {
  console.log([
    'brisk-aitesting',
    '',
    'Commands:',
    '  init                         create brisk-aitesting.config.ts',
    '  run "<goal>"                 plan and run automated tests',
    '',
    'Options for run:',
    '  --config <path>              config file path',
    '  --scenarios <number>         number of scenarios to plan',
    '  --mode <automatic|ui|api|contract|schema|replay|custom>',
    '',
    'Example:',
    '  brisk-aitesting run "Test login, billing, API contracts, and permissions" --scenarios 15',
  ].join('\n'));
}

function parseRunArgs(args: readonly string[]): {
  readonly goal: string;
  readonly scenarios: number;
  readonly mode: 'automatic' | EngineType;
  readonly configPath: string;
} {
  const goalParts: string[] = [];
  let scenarios = 5;
  let mode: 'automatic' | EngineType = 'automatic';
  let configPath = 'brisk-aitesting.config.ts';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scenarios') {
      scenarios = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--mode') {
      mode = parseMode(args[index + 1]);
      index += 1;
    } else if (arg === '--config') {
      configPath = args[index + 1] ?? configPath;
      index += 1;
    } else if (arg !== undefined) {
      goalParts.push(arg);
    }
  }

  return {
    goal: goalParts.join(' ').trim(),
    scenarios: Number.isFinite(scenarios) ? scenarios : 5,
    mode,
    configPath,
  };
}

function parseMode(value: string | undefined): 'automatic' | EngineType {
  const allowed = ['automatic', 'ui', 'api', 'contract', 'schema', 'replay', 'custom'] as const;
  if (value !== undefined && allowed.includes(value as typeof allowed[number])) {
    return value as 'automatic' | EngineType;
  }
  throw new Error(`Invalid --mode. Expected one of: ${allowed.join(', ')}`);
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
