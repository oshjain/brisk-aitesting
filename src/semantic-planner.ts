import { createHash } from 'node:crypto';
import { AiIntentPlanner } from './ai-intent-planner.js';
import type { CapabilityAdapter, CompilationResult, EvidenceGraph, IntentPlan } from './compiler-types.js';
import {
  acquireEvidenceForCompilation,
  InMemoryEvidenceAcquisitionCache,
  requirementsFromCompilation,
} from './evidence-acquisition.js';
import {
  DEFAULT_EVIDENCE_AUTHORITY_POLICY,
  evidenceAuthorityPolicyDigest,
  evidenceGraphDigest,
  mergeEvidenceGraphs,
  resolveEvidenceConflicts,
} from './evidence-graph.js';
import {
  affectedScenarioIdsForEvidenceChange,
  compileIntentIncrementally,
} from './incremental-compilation.js';
import { OpenApiCapabilityAdapter } from './openapi-capability-adapter.js';
import { UniversalSemanticCompiler, evidenceOperationMatchesIntentAction } from './semantic-compiler.js';
import { loweredWorkflowToTestPlan, WorkflowLowerer } from './workflow-lowering.js';
import type {
  AcquisitionRecompilationDecisionV1,
  AiPlannerProvider,
  Planner,
  PlannerContext,
  TestPlan,
} from './types.js';

export class SemanticCompilationError extends Error {
  readonly compilation: CompilationResult;
  readonly evidenceDecisions: readonly AcquisitionRecompilationDecisionV1[];

  constructor(compilation: CompilationResult, evidenceDecisions: readonly AcquisitionRecompilationDecisionV1[] = []) {
    super(formatCompilationDiagnostics(compilation));
    this.name = 'SemanticCompilationError';
    this.compilation = compilation;
    this.evidenceDecisions = evidenceDecisions;
  }
}

export class SemanticPlanner implements Planner {
  readonly name = 'universal-semantic-planner';
  private readonly intentPlanner: AiIntentPlanner;
  private readonly adapters: readonly CapabilityAdapter[];
  private readonly compiler = new UniversalSemanticCompiler();
  private readonly evidenceCache = new InMemoryEvidenceAcquisitionCache();

  constructor(provider: AiPlannerProvider, adapters: readonly CapabilityAdapter[] = []) {
    this.intentPlanner = new AiIntentPlanner(provider);
    const configured = adapters.some((adapter) => adapter.id === 'openapi')
      ? adapters
      : [new OpenApiCapabilityAdapter(), ...adapters];
    this.adapters = uniqueAdapters(configured);
  }

  async plan(context: PlannerContext): Promise<TestPlan> {
    let evidence = await this.collectEvidence(context);
    const intent = await this.intentPlanner.plan(context, evidence);
    let incremental = compileIntentIncrementally({ intent, evidence, compiler: this.compiler });
    let compilation = incremental.result;
    let compilationState = incremental.state;
    const acquisitionDiagnostics: CompilationResult['diagnostics'][number][] = [];
    const evidenceDecisions: AcquisitionRecompilationDecisionV1[] = [];
    const providers = context.config.evidenceProviders ?? [];
    const maxRounds = context.config.planning?.evidenceAcquisitionRounds ?? 2;
    const providerTimeoutMs = context.config.planning?.evidenceProviderTimeoutMs ?? Math.min(context.config.runtime.timeoutMs, 30_000);
    const cacheTtlMs = context.config.planning?.evidenceCacheTtlMs ?? 300_000;
    const cacheMaxEntries = context.config.planning?.evidenceCacheMaxEntries ?? 64;
    const resourceLimits = {
      maxResponseBytes: context.config.planning?.evidenceMaxResponseBytes ?? 10_485_760,
      maxGraphs: context.config.planning?.evidenceMaxGraphsPerResponse ?? 16,
      maxOperations: context.config.planning?.evidenceMaxOperationsPerResponse ?? 10_000,
      maxArtifacts: context.config.planning?.evidenceMaxArtifactsPerResponse ?? 1_000,
    };

    for (let round = 0; round < maxRounds && compilation.status !== 'compiled'; round += 1) {
      const requirements = requirementsFromCompilation(compilation, intent);
      if (requirements.length === 0) {
        evidenceDecisions.push(decisionRecord({
          round: round + 1, outcome: 'stopped', reasonCode: 'NO_ACQUIRABLE_REQUIREMENT',
          explanation: 'Compilation is incomplete, but none of its diagnostics can be answered by an evidence provider.',
          requirements, affectedScenarioIds: [], recompiledScenarioIds: [],
          preservedScenarioIds: intent.scenarios.map((scenario) => scenario.id), acquisition: emptyAcquisition(),
          before: evidence, after: evidence, conflictIds: [], compilation,
        }));
        break;
      }
      if (providers.length === 0) {
        evidenceDecisions.push(decisionRecord({
          round: round + 1, outcome: 'stopped', reasonCode: 'NO_ELIGIBLE_PROVIDER',
          explanation: 'No evidence source is configured for the current missing information; Brisk stopped without inventing an answer.',
          requirements, affectedScenarioIds: scenarioIdsFromRequirements(requirements), recompiledScenarioIds: [],
          preservedScenarioIds: intent.scenarios.map((scenario) => scenario.id), acquisition: emptyAcquisition(),
          before: evidence, after: evidence, conflictIds: [], compilation,
        }));
        break;
      }
      const acquisition = await acquireEvidenceForCompilation({
        plannerContext: context,
        intent,
        currentEvidence: evidence,
        requirements,
        providers,
        timeoutMs: providerTimeoutMs,
        cache: this.evidenceCache,
        cacheTtlMs,
        cacheMaxEntries,
        resourceLimits,
      });
      acquisitionDiagnostics.push(...acquisition.diagnostics);
      if (acquisition.graphs.length === 0) {
        const eligible = acquisition.attemptedProviderIds.length > 0 || acquisition.cacheHitProviderIds.length > 0;
        evidenceDecisions.push(decisionRecord({
          round: round + 1, outcome: 'stopped', reasonCode: eligible ? 'NO_USABLE_EVIDENCE' : 'NO_ELIGIBLE_PROVIDER',
          explanation: eligible
            ? 'Evidence sources were tried, but none returned usable information; the existing compilation result was preserved.'
            : 'No configured evidence source accepted the current missing information; Brisk stopped without inventing an answer.',
          requirements, affectedScenarioIds: scenarioIdsFromRequirements(requirements), recompiledScenarioIds: [],
          preservedScenarioIds: intent.scenarios.map((scenario) => scenario.id), acquisition,
          before: evidence, after: evidence, conflictIds: [], compilation,
        }));
        break;
      }

      const before = evidence;
      const resolution = resolveEvidenceConflicts({
        schemaVersion: 'brisk-aitesting.evidence-conflict-input.v2',
        graphs: [before, ...acquisition.graphs],
        policy: DEFAULT_EVIDENCE_AUTHORITY_POLICY,
      });
      const after = resolution.graph;
      const affectedScenarioIds = affectedScenarioIdsForEvidenceChange({
        intent, requirements, before, after, previous: compilationState,
      });
      if (affectedScenarioIds.length === 0) {
        evidence = after;
        evidenceDecisions.push(decisionRecord({
          round: round + 1, outcome: 'stopped', reasonCode: 'IRRELEVANT_EVIDENCE',
          explanation: 'The acquired information cannot change any current scenario, so Brisk preserved every scenario and stopped the loop.',
          requirements, affectedScenarioIds, recompiledScenarioIds: [],
          preservedScenarioIds: intent.scenarios.map((scenario) => scenario.id), acquisition,
          before, after, conflictIds: resolution.conflicts.filter((conflict) => conflict.status === 'unresolved').map((conflict) => conflict.id), compilation,
        }));
        break;
      }

      incremental = compileIntentIncrementally({
        intent, evidence: after, previous: compilationState, affectedScenarioIds, compiler: this.compiler,
      });
      evidence = after;
      compilationState = incremental.state;
      compilation = incremental.result;
      const conflictIds = relevantUnresolvedConflictIds(after, intent, affectedScenarioIds);
      const contradictory = conflictIds.length > 0;
      evidenceDecisions.push(decisionRecord({
        round: round + 1,
        outcome: contradictory ? 'stopped' : compilation.status === 'compiled' ? 'completed' : 'recompiled',
        reasonCode: contradictory ? 'CONTRADICTORY_EVIDENCE' : 'EVIDENCE_ACQUIRED',
        explanation: contradictory
          ? 'Acquired information conflicts on an affected operation; Brisk rechecked the affected scenarios, kept the conflict visible, and stopped unsafe compilation.'
          : `New evidence affected ${affectedScenarioIds.length} scenario(s); only those scenarios were recompiled.`,
        requirements, affectedScenarioIds,
        recompiledScenarioIds: incremental.recompiledScenarioIds,
        preservedScenarioIds: incremental.preservedScenarioIds,
        acquisition, before, after, conflictIds, compilation,
      }));
      if (contradictory) break;
    }
    if (compilation.status !== 'compiled' && maxRounds === 0) {
      evidenceDecisions.push(decisionRecord({
        round: 0, outcome: 'stopped', reasonCode: 'MAX_ROUNDS_REACHED',
        explanation: 'Evidence acquisition is disabled because the configured round limit is zero.',
        requirements: requirementsFromCompilation(compilation, intent), affectedScenarioIds: [], recompiledScenarioIds: [],
        preservedScenarioIds: intent.scenarios.map((scenario) => scenario.id), acquisition: emptyAcquisition(),
        before: evidence, after: evidence, conflictIds: [], compilation,
      }));
    } else if (compilation.status !== 'compiled'
      && evidenceDecisions.length === maxRounds
      && evidenceDecisions.at(-1)?.outcome !== 'stopped') {
      evidenceDecisions.push(decisionRecord({
        round: maxRounds, outcome: 'stopped', reasonCode: 'MAX_ROUNDS_REACHED',
        explanation: 'The bounded evidence-acquisition rounds finished before every scenario could compile.',
        requirements: requirementsFromCompilation(compilation, intent), affectedScenarioIds: [], recompiledScenarioIds: [],
        preservedScenarioIds: intent.scenarios.map((scenario) => scenario.id), acquisition: emptyAcquisition(),
        before: evidence, after: evidence, conflictIds: [], compilation,
      }));
    }
    if (compilation.status !== 'compiled' || compilation.workflow === undefined) {
      throw new SemanticCompilationError({
        ...compilation,
        diagnostics: [...compilation.diagnostics, ...acquisitionDiagnostics],
      }, evidenceDecisions);
    }
    const lowered = await new WorkflowLowerer(this.adapters).lower({
      workflow: compilation.workflow,
      evidence,
    });
    return loweredWorkflowToTestPlan({
      runId: context.runId,
      goal: context.input.goal,
      workflow: compilation.workflow,
      lowered,
      discovery: context.discovery,
      warnings: [
        ...intent.warnings,
        ...evidence.diagnostics,
        ...acquisitionDiagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      ],
      evidenceDecisions,
    });
  }

  private async collectEvidence(context: PlannerContext): Promise<EvidenceGraph> {
    const graphs: EvidenceGraph[] = [];
    if (context.input.evidenceGraph !== undefined) graphs.push(context.input.evidenceGraph);
    for (const adapter of this.adapters) {
      const graph = await adapter.collect?.({
        config: context.config,
        input: context.input,
        discovery: context.discovery,
        runId: context.runId,
      });
      if (graph !== undefined) graphs.push(graph);
    }
    return mergeEvidenceGraphs(graphs);
  }
}

type DecisionReason = AcquisitionRecompilationDecisionV1['reasonCode'];
type AcquisitionSummary = Pick<Awaited<ReturnType<typeof acquireEvidenceForCompilation>>,
  'attemptedProviderIds' | 'cacheHitProviderIds' | 'graphs' | 'diagnostics'>;

function decisionRecord(params: {
  readonly round: number;
  readonly outcome: AcquisitionRecompilationDecisionV1['outcome'];
  readonly reasonCode: DecisionReason;
  readonly explanation: string;
  readonly requirements: readonly { readonly id: string; readonly scenarioId?: string }[];
  readonly affectedScenarioIds: readonly string[];
  readonly recompiledScenarioIds: readonly string[];
  readonly preservedScenarioIds: readonly string[];
  readonly acquisition: AcquisitionSummary;
  readonly before: EvidenceGraph;
  readonly after: EvidenceGraph;
  readonly conflictIds: readonly string[];
  readonly compilation: CompilationResult;
}): AcquisitionRecompilationDecisionV1 {
  const content = {
    schemaVersion: 'brisk-aitesting.acquisition-recompilation-decision.v1' as const,
    round: params.round,
    outcome: params.outcome,
    reasonCode: params.reasonCode,
    explanation: params.explanation,
    requirementIds: params.requirements.map((entry) => entry.id).sort(),
    affectedScenarioIds: [...params.affectedScenarioIds].sort(),
    recompiledScenarioIds: [...params.recompiledScenarioIds].sort(),
    preservedScenarioIds: [...params.preservedScenarioIds].sort(),
    attemptedProviderIds: [...params.acquisition.attemptedProviderIds].sort(),
    cacheHitProviderIds: [...params.acquisition.cacheHitProviderIds].sort(),
    acquiredGraphRevisions: params.acquisition.graphs.map((graph) => graph.revision).sort(),
    conflictIds: [...params.conflictIds].sort(),
    diagnosticCodes: [...new Set(params.acquisition.diagnostics.map((entry) => entry.code))].sort(),
    beforeEvidenceRevision: params.before.revision,
    afterEvidenceRevision: params.after.revision,
    beforeEvidenceDigest: evidenceGraphDigest(params.before),
    afterEvidenceDigest: evidenceGraphDigest(params.after),
    authorityPolicyDigest: evidenceAuthorityPolicyDigest(DEFAULT_EVIDENCE_AUTHORITY_POLICY),
    compilationStatus: params.compilation.status,
  };
  const id = `decision_${createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 24)}`;
  return { ...content, id };
}

function emptyAcquisition(): AcquisitionSummary {
  return { attemptedProviderIds: [], cacheHitProviderIds: [], graphs: [], diagnostics: [] };
}

function scenarioIdsFromRequirements(requirements: readonly { readonly scenarioId?: string }[]): readonly string[] {
  return [...new Set(requirements.flatMap((requirement) => requirement.scenarioId === undefined ? [] : [requirement.scenarioId]))].sort();
}

function relevantUnresolvedConflictIds(
  evidence: EvidenceGraph,
  intent: IntentPlan,
  affectedScenarioIds: readonly string[],
): readonly string[] {
  const affected = new Set(affectedScenarioIds);
  const relevantOperationIds = new Set(intent.scenarios
    .filter((scenario) => affected.has(scenario.id))
    .flatMap((scenario) => scenario.actions.flatMap((action) => evidence.operations
      .filter((operation) => evidenceOperationMatchesIntentAction(action, operation))
      .map((operation) => operation.id))));
  return (evidence.conflicts ?? [])
    .filter((conflict) => conflict.status === 'unresolved' && relevantOperationIds.has(conflict.operationId))
    .map((conflict) => conflict.id)
    .sort();
}

function uniqueAdapters(adapters: readonly CapabilityAdapter[]): readonly CapabilityAdapter[] {
  const byId = new Map<string, CapabilityAdapter>();
  for (const adapter of adapters) {
    if (byId.has(adapter.id)) throw new Error(`Capability adapter id "${adapter.id}" is registered more than once.`);
    byId.set(adapter.id, adapter);
  }
  return [...byId.values()];
}

function formatCompilationDiagnostics(compilation: CompilationResult): string {
  const detail = compilation.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; ');
  return `Semantic compilation ${compilation.status}${detail.length > 0 ? `: ${detail}` : '.'}`;
}
