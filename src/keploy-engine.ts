import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactRef, Engine, EngineContext, EngineRunResult, ScenarioPlan, ScenarioResult } from './types.js';
import { keployToReplayRequests, replayRequestsToKeployCases, scenarioReplayRequests } from './keploy.js';
import { firstUsefulLine, listFiles, runProcess, scenarioEvidence, scenarioResult } from './engines/shared.js';

export interface KeployEngineOptions {
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly mode?: 'record' | 'test' | 'record-and-test';
  readonly appCommand?: string;
  readonly path?: string;
  readonly configPath?: string;
  readonly delaySeconds?: number;
  readonly proxyPort?: number;
  readonly apiTimeoutSeconds?: number;
}

export class KeployCliEngine implements Engine {
  readonly name = 'keploy-cli-engine';
  readonly type = 'replay' as const;
  private readonly options: Required<Omit<KeployEngineOptions, 'appCommand' | 'path' | 'configPath' | 'proxyPort'>> & {
    readonly appCommand?: string;
    readonly path?: string;
    readonly configPath?: string;
    readonly proxyPort?: number;
  };

  constructor(options: KeployEngineOptions = {}) {
    this.options = {
      command: options.command ?? 'keploy',
      commandArgs: options.commandArgs ?? [],
      mode: options.mode ?? 'test',
      delaySeconds: options.delaySeconds ?? 5,
      apiTimeoutSeconds: options.apiTimeoutSeconds ?? 5,
      ...(options.appCommand !== undefined ? { appCommand: options.appCommand } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      ...(options.proxyPort !== undefined ? { proxyPort: options.proxyPort } : {}),
    };
  }

  canRun(scenario: ScenarioPlan): boolean {
    return scenario.type === 'replay' && adapterName(scenario) === 'keploy';
  }

  async run(context: EngineContext): Promise<EngineRunResult> {
    const started = Date.now();
    const dir = join(context.config.runtime.artifactsDir, context.runId, 'keploy');
    const keployPath = pathFromScenario(context.scenario) ?? this.options.path ?? join(dir, 'keploy');
    await mkdir(keployPath, { recursive: true });
    await mkdir(dir, { recursive: true });

    const declaredRequests = scenarioReplayRequests(context.scenario);
    if (declaredRequests.length > 0) {
      const exported = replayRequestsToKeployCases(context.scenario.id, declaredRequests);
      await writeFile(join(dir, `${context.scenario.id}.keploy-export.json`), `${JSON.stringify({ tests: exported }, null, 2)}\n`, 'utf8');
    }

    const runs: KeployCommandRun[] = [];
    if (this.options.mode === 'record' || this.options.mode === 'record-and-test') {
      runs.push(await this.runKeploy('record', context, keployPath));
    }
    if (this.options.mode === 'test' || this.options.mode === 'record-and-test') {
      runs.push(await this.runKeploy('test', context, keployPath));
    }

    const logPath = join(dir, `${context.scenario.id}.keploy.log`);
    const evidencePath = join(dir, `${context.scenario.id}.keploy-evidence.json`);
    await writeFile(logPath, runs.map((run) => [
      `$ ${[run.command, ...run.displayArgs].map(shellQuote).join(' ')}`,
      run.stdout,
      run.stderr,
    ].filter((part) => part.trim().length > 0).join('\n\n')).join('\n\n---\n\n'), 'utf8');

    const keployFiles = existsSync(keployPath) ? await listFiles(keployPath) : [];
    const parsedCases = await readGeneratedCases(keployFiles);
    const status = runs.length === 0
      ? 'skipped'
      : runs.some((run) => run.timedOut || run.exitCode === null)
        ? 'error'
        : runs.some((run) => run.exitCode !== 0)
          ? 'failed'
          : 'passed';
    const diagnostics = [
      ...runs.flatMap((run) => run.diagnostics),
      ...(keployFiles.length === 0 ? ['Keploy did not write generated files in the configured path.'] : []),
    ];

    const artifacts: ArtifactRef[] = [
      { kind: 'log', path: logPath, label: 'Keploy execution log', metadata: { scenarioId: context.scenario.id } },
      ...keployFiles.map((path): ArtifactRef => ({
        kind: artifactKind(path),
        path,
        label: 'Keploy generated artifact',
        metadata: { schemaVersion: 'brisk-aitesting.keploy-artifact.v1', scenarioId: context.scenario.id },
      })),
    ];

    const evidence = {
      schemaVersion: 'brisk-aitesting.keploy-evidence.v1',
      scenario: scenarioEvidence(context),
      mode: this.options.mode,
      keployPath,
      status,
      commands: runs.map((run) => ({
        mode: run.mode,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        command: run.command,
        args: run.displayArgs,
      })),
      generated: {
        files: keployFiles.length,
        parsedHttpCases: parsedCases.length,
        replayRequests: keployToReplayRequests(parsedCases).length,
      },
      artifacts: artifacts.map((artifact) => ({ kind: artifact.kind, path: artifact.path, label: artifact.label })),
      diagnostics,
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    artifacts.push({
      kind: 'json',
      path: evidencePath,
      label: 'Keploy evidence',
      metadata: { schemaVersion: 'brisk-aitesting.keploy-evidence.v1', scenarioId: context.scenario.id },
    });

    const assertions: ScenarioResult['assertions'][number][] = [
      { name: 'Keploy CLI executed', status: status === 'error' ? 'error' : runs.length > 0 ? 'passed' : 'skipped' },
      { name: 'Keploy generated local artifacts', status: keployFiles.length > 0 ? 'passed' : status, ...(keployFiles.length > 0 ? {} : { message: diagnostics.join('; ') }) },
      { name: 'Keploy evidence emitted', status: 'passed' },
    ];

    return {
      artifacts,
      result: scenarioResult(context, {
        engine: this.name,
        status,
        durationMs: Date.now() - started,
        artifacts,
        diagnostics,
        assertions,
      }),
    };
  }

  private async runKeploy(mode: 'record' | 'test', context: EngineContext, keployPath: string): Promise<KeployCommandRun> {
    const appCommand = appCommandFromScenario(context.scenario) ?? this.options.appCommand;
    const args = [
      ...this.options.commandArgs,
      mode,
      ...(appCommand !== undefined ? ['--command', appCommand] : []),
      '--path',
      keployPath,
      '--delay',
      String(this.options.delaySeconds),
      ...(mode === 'test' ? ['--api-timeout', String(this.options.apiTimeoutSeconds), '--generate-test-report', 'true'] : []),
      ...(this.options.configPath !== undefined ? ['--config-path', this.options.configPath] : []),
      ...(this.options.proxyPort !== undefined ? ['--proxy-port', String(this.options.proxyPort)] : []),
    ];
    const execution = await runProcess(this.options.command, args, {
      cwd: context.config.app.repoPath ?? process.cwd(),
      timeoutMs: context.config.runtime.timeoutMs,
    });
    return {
      mode,
      command: this.options.command,
      displayArgs: args.map(redactCommandArg),
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
      timedOut: execution.timedOut,
      diagnostics: commandDiagnostics('Keploy', execution),
    };
  }
}

interface KeployCommandRun {
  readonly mode: 'record' | 'test';
  readonly command: string;
  readonly displayArgs: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly diagnostics: readonly string[];
}

function adapterName(scenario: ScenarioPlan): string | undefined {
  const adapter = scenario.metadata?.adapter ?? scenario.metadata?.engine;
  return typeof adapter === 'string' ? adapter.toLowerCase() : undefined;
}

function appCommandFromScenario(scenario: ScenarioPlan): string | undefined {
  const replay = scenario.metadata?.replay;
  if (!isRecord(replay)) return undefined;
  return typeof replay.keployCommand === 'string' ? replay.keployCommand : undefined;
}

function pathFromScenario(scenario: ScenarioPlan): string | undefined {
  const replay = scenario.metadata?.replay;
  if (!isRecord(replay)) return undefined;
  return typeof replay.keployPath === 'string' ? replay.keployPath : undefined;
}

async function readGeneratedCases(files: readonly string[]): Promise<readonly unknown[]> {
  const cases = [];
  for (const file of files) {
    if (!/\.(json|ya?ml)$/i.test(file)) continue;
    try {
      const raw = await readFile(file, 'utf8');
      if (/\.json$/i.test(file)) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) cases.push(...parsed);
        else cases.push(parsed);
      } else {
        cases.push({ source: file, raw });
      }
    } catch {
      // Bad generated files are still attached as artifacts; parser coverage reports what it can read.
    }
  }
  return cases;
}

function commandDiagnostics(label: string, execution: { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean }): readonly string[] {
  const diagnostics = [];
  if (execution.timedOut) diagnostics.push(`${label} timed out.`);
  diagnostics.push(`${label} exited with code ${execution.exitCode ?? 'unknown'}.`);
  if (execution.stderr.trim().length > 0) diagnostics.push(firstUsefulLine(execution.stderr));
  if (execution.stdout.trim().length > 0) diagnostics.push(firstUsefulLine(execution.stdout));
  return diagnostics;
}

function artifactKind(path: string): ArtifactRef['kind'] {
  const lower = path.toLowerCase();
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.xml')) return 'junit';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.log')) return 'log';
  return 'other';
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,\\-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function redactCommandArg(value: string): string {
  return /authorization|cookie|token|secret|password|Bearer\s+/i.test(value) ? '[redacted]' : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
