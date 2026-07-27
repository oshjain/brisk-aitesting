import { randomUUID } from 'node:crypto';
import { AiPlanner } from './ai-planner.js';
import { normalizeConfig, type UserConfig } from './config.js';
import { BuiltinDiscoverer } from './discovery.js';
import { BuiltinApiEngine, BuiltinContractEngine, BuiltinPlaywrightEngine, BuiltinPlaywrightRouteGrounder, BuiltinReplayEngine, BuiltinSchemaFuzzEngine } from './engines.js';
import { buildResult, persistCiReports, persistResult } from './handover.js';
import { BuiltinPlanner } from './planner.js';
import { BuiltinPlanValidator } from './validation.js';
import type {
  BriskAiTestingConfig,
  BriskAiTestingEvent,
  BriskAiTestingResult,
  BriskAiTestingRunInput,
  Discoverer,
  Engine,
  Planner,
  PlanValidator,
  ScenarioResult,
  TestPlan,
  ArtifactRef,
  UiRouteGrounder,
  ValidationResult,
} from './types.js';

export class BriskAiTesting {
  private readonly config: BriskAiTestingConfig;
  private readonly discoverer: Discoverer;
  private readonly planner: Planner;
  private readonly validator: PlanValidator;
  private readonly engines: readonly Engine[];
  private readonly uiRouteGrounder: UiRouteGrounder;
  private readonly listeners = new Set<(event: BriskAiTestingEvent) => void>();

  constructor(configInput: BriskAiTestingConfig | UserConfig, params?: {
    readonly discoverer?: Discoverer;
    readonly planner?: Planner;
    readonly validator?: PlanValidator;
    readonly engines?: readonly Engine[];
    readonly uiRouteGrounder?: UiRouteGrounder;
  }) {
    this.config = normalizeConfig(configInput);
    this.discoverer = params?.discoverer ?? this.config.discoverer ?? new BuiltinDiscoverer();
    this.planner = params?.planner ?? (this.config.aiProvider !== undefined ? new AiPlanner(this.config.aiProvider) : new BuiltinPlanner());
    this.validator = params?.validator ?? this.config.validator ?? new BuiltinPlanValidator();
    this.engines = params?.engines ?? this.config.engines ?? [
      new BuiltinApiEngine(),
      new BuiltinPlaywrightEngine(),
      new BuiltinSchemaFuzzEngine(),
      new BuiltinReplayEngine(),
      new BuiltinContractEngine(),
    ];
    this.uiRouteGrounder = params?.uiRouteGrounder ?? new BuiltinPlaywrightRouteGrounder();
  }

  onEvent(listener: (event: BriskAiTestingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async run(input: BriskAiTestingRunInput): Promise<BriskAiTestingResult> {
    if (input.goal.trim().length === 0) throw new Error('run.goal is required');

    const runId = `run_${randomUUID()}`;
    const startedAt = Date.now();
    this.emit({ type: 'run.started', runId, goal: input.goal });

    const discovery = await this.discoverer.discover({ config: this.config, input, runId });
    this.emit({ type: 'discovery.completed', runId, discovery });

    const rawPlan = await this.planner.plan({ config: this.config, input, runId, discovery });
    const initialPlan = { ...rawPlan, discovery };
    this.emit({ type: 'plan.created', runId, plan: initialPlan });
    let plan = await this.validateAndRepairPlan({
      input,
      runId,
      discovery,
      plan: initialPlan,
    });

    const tests: ScenarioResult[] = [];
    const artifacts = [];
    const enriched = await this.enrichUiActionsFromGrounding({ input, runId, discovery, plan });
    plan = enriched.plan;
    artifacts.push(...enriched.artifacts);

    for (const scenario of plan.scenarios) {
      this.emit({ type: 'scenario.started', runId, scenario });
      const engine = this.engines.find((candidate) => candidate.canRun(scenario));
      if (engine === undefined) {
        const result: ScenarioResult = {
          scenarioId: scenario.id,
          name: scenario.name,
          type: scenario.type,
          engine: 'none',
          status: 'skipped',
          durationMs: 0,
          assertions: scenario.assertions.map((assertion) => ({ name: assertion, status: 'skipped' })),
          artifacts: [],
          diagnostics: [`No engine registered for scenario type "${scenario.type}".`],
        };
        tests.push(result);
        this.emit({ type: 'scenario.completed', runId, result });
        continue;
      }

      const output = await engine.run({ config: this.config, runId, plan, scenario });
      if (output.artifacts !== undefined) artifacts.push(...output.artifacts);
      tests.push(output.result);
      this.emit({ type: 'scenario.completed', runId, result: output.result });
    }

    const resultWithoutFile = buildResult({
      config: this.config,
      goal: input.goal,
      runId,
      plan,
      discovery,
      startedAt,
      tests,
      artifacts,
    });
    const resultArtifact = await persistResult(this.config, resultWithoutFile);
    const reportArtifacts = await persistCiReports(this.config, resultWithoutFile);
    const finalResult = {
      ...resultWithoutFile,
      artifacts: [...resultWithoutFile.artifacts, resultArtifact, ...reportArtifacts],
    };
    this.emit({ type: 'run.completed', runId, result: finalResult });
    return finalResult;
  }

  private emit(event: BriskAiTestingEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async validateAndRepairPlan(params: {
    readonly input: BriskAiTestingRunInput;
    readonly runId: string;
    readonly discovery: TestPlan['discovery'];
    readonly plan: TestPlan;
  }): Promise<TestPlan> {
    let plan = params.plan;
    let validation = await this.validator.validate({ config: this.config, input: params.input, plan });
    this.emit({ type: 'plan.validated', runId: params.runId, validation });

    const maxAttempts = normalizeRepairAttempts(this.config.ai?.repairAttempts);
    for (let attempt = 1; !validation.valid && attempt <= maxAttempts && this.planner.repair !== undefined; attempt += 1) {
      this.emit({ type: 'plan.repair.started', runId: params.runId, attempt, validation });
      const repaired = await this.planner.repair({
        config: this.config,
        input: params.input,
        runId: params.runId,
        discovery: params.discovery,
        attempt,
        maxAttempts,
        invalidPlan: plan,
        validation,
      });
      plan = { ...repaired, discovery: params.discovery };
      this.emit({ type: 'plan.repaired', runId: params.runId, attempt, plan });
      validation = await this.validator.validate({ config: this.config, input: params.input, plan });
      this.emit({ type: 'plan.validated', runId: params.runId, validation });
    }

    if (!validation.valid) {
      throw new Error(formatValidationFailure(validation));
    }
    return plan;
  }

  private async enrichUiActionsFromGrounding(params: {
    readonly input: BriskAiTestingRunInput;
    readonly runId: string;
    readonly discovery: TestPlan['discovery'];
    readonly plan: TestPlan;
  }): Promise<{ readonly plan: TestPlan; readonly artifacts: readonly ArtifactRef[] }> {
    const mode = params.input.uiActionFeedback ?? 'off';
    if (mode === 'off' || this.planner.enrichUiActions === undefined) return { plan: params.plan, artifacts: [] };

    const artifacts = [];
    const scenarios = [];
    let changed = false;
    for (const scenario of params.plan.scenarios) {
      if (scenario.type !== 'ui') {
        scenarios.push(scenario);
        continue;
      }
      if (mode === 'when-missing' && scenario.uiActions !== undefined && scenario.uiActions.length > 0) {
        scenarios.push(scenario);
        continue;
      }
      const grounded = await this.uiRouteGrounder.ground({ config: this.config, runId: params.runId, scenario });
      artifacts.push(...grounded.artifacts);
      this.emit({ type: 'ui.grounding.completed', runId: params.runId, scenario, grounding: grounded.grounding });
      const actions = await this.planner.enrichUiActions({
        config: this.config,
        input: params.input,
        runId: params.runId,
        discovery: params.discovery,
        scenario,
        grounding: grounded.grounding,
      });
      this.emit({ type: 'ui.actions.enriched', runId: params.runId, scenario, actions });
      if (actions.length > 0) {
        scenarios.push({ ...scenario, uiActions: actions });
        changed = true;
      } else {
        scenarios.push(scenario);
      }
    }
    if (!changed) return { plan: params.plan, artifacts };
    const plan = { ...params.plan, scenarios };
    const validation = await this.validator.validate({ config: this.config, input: params.input, plan });
    this.emit({ type: 'plan.validated', runId: params.runId, validation });
    if (!validation.valid) throw new Error(formatValidationFailure(validation));
    this.emit({ type: 'plan.enriched', runId: params.runId, plan });
    return { plan, artifacts };
  }
}

function normalizeRepairAttempts(value: number | undefined): number {
  if (value === undefined) return 2;
  if (!Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function formatValidationFailure(validation: ValidationResult): string {
  return `Plan validation failed: ${validation.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`;
}

export function createBriskAiTesting(config: BriskAiTestingConfig | UserConfig, params?: {
  readonly discoverer?: Discoverer;
  readonly planner?: Planner;
  readonly validator?: PlanValidator;
  readonly engines?: readonly Engine[];
  readonly uiRouteGrounder?: UiRouteGrounder;
}): BriskAiTesting {
  return new BriskAiTesting(config, params);
}
