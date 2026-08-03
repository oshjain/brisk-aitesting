import { createHash, randomUUID } from 'node:crypto';
import type {
  CompilationDiagnostic,
  CompilationResult,
  EvidenceAuthority,
  EvidenceGraph,
  EvidenceOperation,
  EvidenceValueSlot,
  IntentAction,
  IntentPlan,
  IntentValue,
  WorkflowInputBinding,
  WorkflowPlan,
  WorkflowScenario,
  WorkflowStep,
  WorkflowValueBinding,
  WorkflowValueConversion,
  WorkflowValueFlowV1,
  WorkflowValueRecordV1,
  WorkflowSelectionDecisionV1,
  WorkflowCleanupSafetyRecordV1,
} from './compiler-types.js';
import { containsObviousSecretLikeValue } from './secret-safety.js';

const MUTATION_AUTHORITIES = new Set<EvidenceAuthority>(['host', 'contract', 'runtime', 'observed']);
const VERB_ALIASES: Readonly<Record<string, readonly string[]>> = {
  create: ['add', 'create', 'make', 'provision', 'register'],
  read: ['fetch', 'get', 'inspect', 'list', 'observe', 'read', 'retrieve', 'verify', 'view'],
  update: ['change', 'edit', 'modify', 'patch', 'set', 'update'],
  delete: ['delete', 'destroy', 'remove'],
  publish: ['emit', 'produce', 'publish', 'send'],
  consume: ['consume', 'listen', 'receive', 'subscribe'],
  authenticate: ['authenticate', 'login', 'sign in'],
  navigate: ['go', 'navigate', 'open', 'visit'],
};

interface AvailableOutput {
  readonly stepId: string;
  readonly slot: EvidenceValueSlot;
  readonly operation: EvidenceOperation;
}

export class UniversalSemanticCompiler {
  compile(intent: IntentPlan, evidence: EvidenceGraph): CompilationResult {
    const diagnostics: CompilationDiagnostic[] = [];
    const scenarios: WorkflowScenario[] = [];
    const intentScenarioIds = new Set<string>();

    for (const intentScenario of intent.scenarios) {
      if (intentScenarioIds.has(intentScenario.id)) {
        diagnostics.push({ code: 'DUPLICATE_INTENT_SCENARIO_ID', message: `Intent contains duplicate scenario id ${intentScenario.id}.`, scenarioId: intentScenario.id });
        continue;
      }
      intentScenarioIds.add(intentScenario.id);
      const actionIds = new Set<string>();
      const duplicateActionId = intentScenario.actions.find((action) => {
        if (actionIds.has(action.id)) return true;
        actionIds.add(action.id);
        return false;
      })?.id;
      if (duplicateActionId !== undefined) {
        diagnostics.push({ code: 'DUPLICATE_INTENT_ACTION_ID', message: `Intent scenario ${intentScenario.id} contains duplicate action id ${duplicateActionId}.`, scenarioId: intentScenario.id });
        continue;
      }
      const steps: WorkflowStep[] = [];
      const available: AvailableOutput[] = [];

      for (const action of intentScenario.actions) {
        const candidates = rankedCandidates(action, evidence.operations);
        if (candidates.length === 0) {
          diagnostics.push({
            code: 'NO_OPERATION_FOR_INTENT',
            message: `No evidenced operation can perform "${action.verb} ${action.resource}".`,
            scenarioId: intentScenario.id,
            actionId: action.id,
          });
          continue;
        }

        const selected = selectUnambiguousCandidate(candidates);
        if (selected === undefined) {
          diagnostics.push({
            code: 'AMBIGUOUS_OPERATION',
            message: `More than one evidenced operation can perform "${action.verb} ${action.resource}".`,
            scenarioId: intentScenario.id,
            actionId: action.id,
            operationIds: candidates.filter((candidate) => candidate.score === candidates[0]?.score).map((candidate) => candidate.operation.id),
          });
          continue;
        }

        const operationIssues = executableOperationIssues(selected.operation);
        if (operationIssues.length > 0) {
          diagnostics.push(...operationIssues.map((message) => ({
            code: 'OPERATION_NOT_EXECUTABLE',
            message,
            scenarioId: intentScenario.id,
            actionId: action.id,
            operationIds: [selected.operation.id],
          })));
          continue;
        }

        const stepId = `step_${sanitizeId(action.id)}_${steps.length + 1}`;
        const inputs = bindInputs(action, selected.operation, available, diagnostics, intentScenario.id);
        if (inputs === undefined) continue;
        const dependsOn = [...new Set(inputs
          .map((input) => input.value.kind === 'output' ? input.value.stepId : undefined)
          .filter((step): step is string => step !== undefined))];
        const expectedOutcomeIds = resolveOutcomes(action, selected.operation, diagnostics, intentScenario.id);
        if (expectedOutcomeIds === undefined) continue;

        const step: WorkflowStep = {
          id: stepId,
          intentActionId: action.id,
          operationId: selected.operation.id,
          adapterId: selected.operation.adapterId,
          capability: selected.operation.capability,
          phase: action.phase ?? 'test',
          inputs,
          captures: selected.operation.outputs.map((slot) => ({
            outputSlotId: slot.id,
            semanticType: slot.semanticType,
          })),
          dependsOn,
          expectedOutcomeIds,
          evidence: selected.operation.provenance,
          sideEffect: selected.operation.sideEffect,
        };
        steps.push(step);
        available.push(...selected.operation.outputs.map((slot) => ({ stepId, slot, operation: selected.operation })));
      }

      const allIntentActionsCompiled = steps.length === intentScenario.actions.length;
      const cleanupIds = synthesizeCleanupSteps({
        scenarioId: intentScenario.id,
        cleanupPolicy: intentScenario.cleanup,
        steps,
        available,
        evidence,
        diagnostics,
      });
      if (allIntentActionsCompiled) {
        const executableSteps = retainConsumedCaptures(steps);
        scenarios.push({
          id: `workflow_${sanitizeId(intentScenario.id)}`,
          intentScenarioId: intentScenario.id,
          name: intentScenario.name,
          objective: intentScenario.objective,
          steps: executableSteps,
          invariants: intentScenario.invariants,
          cleanupPolicy: intentScenario.cleanup,
          cleanupStepIds: cleanupIds,
          valueFlow: buildValueFlow(executableSteps, intentScenario.id),
        });
      }
    }

    const status = compilationStatus(diagnostics);
    if (status !== 'compiled') {
      return {
        schemaVersion: 'brisk-aitesting.compilation.v1',
        status,
        diagnostics,
      };
    }

    const selectionDecisions = selectionDecisionsForWorkflow(intent, evidence, scenarios);
    const cleanupSafetyRecords = cleanupSafetyRecordsForWorkflow(evidence, scenarios);
    const workflowContent = {
      schemaVersion: 'brisk-aitesting.workflow.v1',
      evidenceRevision: evidence.revision,
      goal: intent.goal,
      scenarios,
      selectionDecisions,
      cleanupSafetyRecords,
      createdAt: new Date().toISOString(),
    } as const;
    const workflow: WorkflowPlan = { ...workflowContent, id: deterministicWorkflowId(workflowContent) };
    const invariantDiagnostics = validateWorkflowInvariants(workflow, evidence);
    if (invariantDiagnostics.length > 0) {
      return {
        schemaVersion: 'brisk-aitesting.compilation.v1',
        status: 'needs-evidence',
        diagnostics: invariantDiagnostics,
      };
    }
    return {
      schemaVersion: 'brisk-aitesting.compilation.v1',
      status: 'compiled',
      workflow,
      diagnostics: [],
    };
  }
}

export function deterministicWorkflowId(workflow: Omit<WorkflowPlan, 'id'>): string {
  const stableContent = {
    schemaVersion: workflow.schemaVersion,
    evidenceRevision: workflow.evidenceRevision,
    goal: workflow.goal,
    scenarios: workflow.scenarios,
    selectionDecisions: workflow.selectionDecisions,
    cleanupSafetyRecords: workflow.cleanupSafetyRecords,
  };
  return `workflow_${createHash('sha256').update(stableSerialize(stableContent)).digest('hex').slice(0, 24)}`;
}

export function cleanupSafetyRecordsForWorkflow(
  evidence: EvidenceGraph,
  scenarios: readonly WorkflowScenario[],
): readonly WorkflowCleanupSafetyRecordV1[] {
  const operations = new Map(evidence.operations.map((operation) => [operation.id, operation]));
  return scenarios.flatMap((scenario) => scenario.cleanupStepIds.map((cleanupStepId) => {
    const cleanupStep = scenario.steps.find((step) => step.id === cleanupStepId);
    if (cleanupStep === undefined) throw new Error(`Cleanup step ${cleanupStepId} is missing from scenario ${scenario.id}.`);
    const sourceStep = scenario.steps.find((candidate) => (
      candidate.id !== cleanupStep.id
      && cleanupStep.dependsOn.includes(candidate.id)
      && operations.get(candidate.operationId)?.cleanupOperationId === cleanupStep.operationId
    ));
    if (sourceStep === undefined) throw new Error(`Cleanup step ${cleanupStep.id} has no declared resource-producing source step.`);
    const requiredValues = cleanupStep.inputs.map((input) => ({
      inputSlotId: input.inputSlotId,
      sourceKind: cleanupValueSourceKind(input.value.kind),
      ...(input.value.kind === 'output' ? {
        producerStepId: input.value.stepId,
        outputSlotId: input.value.outputSlotId,
      } : {}),
      semanticType: input.value.semanticType,
    }));
    const content = {
      schemaVersion: 'brisk-aitesting.workflow-cleanup-safety.v1' as const,
      scenarioId: scenario.id,
      sourceStepId: sourceStep.id,
      sourceOperationId: sourceStep.operationId,
      cleanupStepId: cleanupStep.id,
      cleanupOperationId: cleanupStep.operationId,
      dependsOnCleanupStepIds: cleanupStep.dependsOn.filter((id) => scenario.cleanupStepIds.includes(id)),
      requiredValues,
      expectedOutcomeIds: cleanupStep.expectedOutcomeIds,
      evidenceRevision: evidence.revision,
      provenance: cleanupStep.evidence,
      recoveryPolicy: 'cleanup-only-no-unknown-mutation-replay' as const,
    };
    return { ...content, id: cleanupSafetyRecordId(content) };
  }));
}

function cleanupValueSourceKind(kind: WorkflowValueBinding['kind']): WorkflowCleanupSafetyRecordV1['requiredValues'][number]['sourceKind'] {
  if (kind === 'output') return 'step-output';
  if (kind === 'secret') return 'secret-reference';
  return kind;
}

function cleanupSafetyRecordId(record: Omit<WorkflowCleanupSafetyRecordV1, 'id'>): string {
  return `cleanup_${createHash('sha256').update(stableSerialize(record)).digest('hex').slice(0, 24)}`;
}

export function selectionDecisionsForWorkflow(
  intent: IntentPlan,
  evidence: EvidenceGraph,
  scenarios: readonly WorkflowScenario[],
): readonly WorkflowSelectionDecisionV1[] {
  const intentScenarios = new Map(intent.scenarios.map((scenario) => [scenario.id, scenario]));
  const operations = new Map(evidence.operations.map((operation) => [operation.id, operation]));
  return scenarios.flatMap((scenario) => {
    const intentScenario = intentScenarios.get(scenario.intentScenarioId);
    const actions = new Map(intentScenario?.actions.map((action) => [action.id, action]) ?? []);
    return scenario.steps.map((step): WorkflowSelectionDecisionV1 => {
      const operation = operations.get(step.operationId);
      if (operation === undefined) throw new Error(`Cannot record decision for unknown operation ${step.operationId}.`);
      const action = actions.get(step.intentActionId);
      const candidates = action === undefined
        ? [{ operationId: operation.id, score: 1 }]
        : rankedCandidates(action, evidence.operations).map((candidate) => ({ operationId: candidate.operation.id, score: candidate.score }));
      const content = {
        schemaVersion: 'brisk-aitesting.workflow-selection-decision.v1' as const,
        scenarioId: scenario.id,
        stepId: step.id,
        intentActionId: step.intentActionId,
        phase: step.phase,
        candidates,
        selectedOperationId: step.operationId,
        selectionReason: (step.phase === 'cleanup' ? 'declared-cleanup-operation' : 'highest-unambiguous-score') as WorkflowSelectionDecisionV1['selectionReason'],
        expectedOutcomeIds: step.expectedOutcomeIds,
        evidenceRevision: evidence.revision,
        provenance: step.evidence,
      };
      return { ...content, id: selectionDecisionId(content) };
    });
  });
}

function selectionDecisionId(decision: Omit<WorkflowSelectionDecisionV1, 'id'>): string {
  return `selection_${createHash('sha256').update(stableSerialize(decision)).digest('hex').slice(0, 24)}`;
}

function retainConsumedCaptures(steps: readonly WorkflowStep[]): readonly WorkflowStep[] {
  const consumed = new Set(steps.flatMap((step) => step.inputs
    .filter((input) => input.value.kind === 'output')
    .map((input) => {
      const value = input.value;
      return value.kind === 'output' ? `${value.stepId}:${value.outputSlotId}` : '';
    })));
  return steps.map((step) => ({
    ...step,
    captures: step.captures.filter((capture) => consumed.has(`${step.id}:${capture.outputSlotId}`)),
  }));
}

/** Builds metadata about value movement after the final step list is known.
 * Raw values are intentionally omitted, so this record is safe to inspect. */
function buildValueFlow(steps: readonly WorkflowStep[], scenarioId: string): WorkflowValueFlowV1 {
  const stepOrder = new Map(steps.map((step, index) => [step.id, index]));
  const outputRecords = new Map<string, WorkflowValueRecordV1>();
  const externalRecords: WorkflowValueRecordV1[] = [];

  for (const step of steps) {
    for (const input of step.inputs) {
      const consumer = {
        stepId: step.id,
        inputSlotId: input.inputSlotId,
        ...(input.value.conversion === undefined ? {} : { conversion: input.value.conversion }),
      };
      if (input.value.kind === 'output') {
        const outputValue = input.value;
        const key = `${outputValue.stepId}:${outputValue.outputSlotId}`;
        const prior = outputRecords.get(key);
        const producerStep = steps.find((candidate) => candidate.id === outputValue.stepId);
        const producerType = producerStep?.captures.find((capture) => capture.outputSlotId === outputValue.outputSlotId)?.semanticType
          ?? outputValue.semanticType;
        const consumers = [...(prior?.consumers ?? []), consumer];
        const lastConsumer = [...consumers].sort((left, right) => (stepOrder.get(left.stepId) ?? -1) - (stepOrder.get(right.stepId) ?? -1)).at(-1);
        outputRecords.set(key, {
          id: prior?.id ?? `value_${sanitizeId(scenarioId)}_${sanitizeId(outputValue.stepId)}_${sanitizeId(outputValue.outputSlotId)}`,
          semanticType: producerType,
          source: { kind: 'step-output' },
          producer: { kind: 'step-output', stepId: outputValue.stepId, outputSlotId: outputValue.outputSlotId },
          consumers,
          lifetime: {
            scope: 'scenario',
            startsAt: `after:${outputValue.stepId}`,
            endsAt: `after:${lastConsumer?.stepId ?? step.id}`,
          },
          secret: false,
        });
        continue;
      }
      const source = input.value.kind === 'secret'
        ? { kind: 'secret-reference' as const, reference: input.value.secretRef }
        : input.value.kind === 'fixture'
          ? { kind: 'fixture' as const, reference: input.value.fixture }
          : input.value.kind === 'generated'
            ? { kind: 'generated' as const, reference: input.value.generation.kind }
            : { kind: 'intent' as const };
      externalRecords.push({
        id: `value_${sanitizeId(scenarioId)}_${sanitizeId(step.id)}_${sanitizeId(input.inputSlotId)}`,
        semanticType: input.value.semanticType,
        source,
        producer: { kind: 'external' },
        consumers: [consumer],
        lifetime: { scope: 'scenario', startsAt: 'scenario-start', endsAt: `after:${step.id}` },
        secret: input.value.kind === 'secret',
      });
    }
  }
  return {
    schemaVersion: 'brisk-aitesting.value-flow.v1',
    values: [...externalRecords, ...outputRecords.values()],
  };
}

export function validateWorkflowInvariants(workflow: WorkflowPlan, evidence: EvidenceGraph): readonly CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  const operations = new Map(evidence.operations.map((operation) => [operation.id, operation]));
  if (workflow.evidenceRevision !== evidence.revision) {
    diagnostics.push({ code: 'STALE_EVIDENCE_REVISION', message: 'Workflow evidence revision does not match the graph being validated.' });
  }
  const { id: workflowId, ...workflowWithoutId } = workflow;
  if (workflowId !== deterministicWorkflowId(workflowWithoutId)) {
    diagnostics.push({ code: 'ALTERED_WORKFLOW_IDENTITY', message: 'Workflow identity does not match its stable semantic content.' });
  }
  const decisionsByStep = new Map<string, WorkflowSelectionDecisionV1>();
  const decisionIds = new Set<string>();
  for (const decision of workflow.selectionDecisions) {
    if (decisionIds.has(decision.id)) diagnostics.push({ code: 'DUPLICATE_SELECTION_DECISION', message: `Selection decision id ${decision.id} is duplicated.` });
    decisionIds.add(decision.id);
    if (decisionsByStep.has(`${decision.scenarioId}:${decision.stepId}`)) {
      diagnostics.push({ code: 'DUPLICATE_SELECTION_DECISION', message: `Workflow step ${decision.stepId} has more than one selection decision.`, scenarioId: decision.scenarioId });
    }
    decisionsByStep.set(`${decision.scenarioId}:${decision.stepId}`, decision);
    const { id, ...decisionWithoutId } = decision;
    if (id !== selectionDecisionId(decisionWithoutId)) diagnostics.push({ code: 'ALTERED_SELECTION_DECISION', message: `Selection decision ${id} does not match its recorded facts.`, scenarioId: decision.scenarioId });
    if (decision.evidenceRevision !== evidence.revision) diagnostics.push({ code: 'STALE_SELECTION_DECISION', message: `Selection decision ${id} uses a stale evidence revision.`, scenarioId: decision.scenarioId });
  }
  let expectedCleanupRecords: readonly WorkflowCleanupSafetyRecordV1[] = [];
  try {
    expectedCleanupRecords = cleanupSafetyRecordsForWorkflow(evidence, workflow.scenarios);
  } catch (error) {
    diagnostics.push({ code: 'INVALID_CLEANUP_SAFETY_RECORD', message: error instanceof Error ? error.message : 'Cleanup safety facts could not be reconstructed.' });
  }
  const expectedCleanupByStep = new Map(expectedCleanupRecords.map((record) => [`${record.scenarioId}:${record.cleanupStepId}`, record]));
  const cleanupRecordKeys = new Set<string>();
  for (const record of workflow.cleanupSafetyRecords) {
    const key = `${record.scenarioId}:${record.cleanupStepId}`;
    if (cleanupRecordKeys.has(key)) {
      diagnostics.push({ code: 'DUPLICATE_CLEANUP_SAFETY_RECORD', message: `Cleanup step ${record.cleanupStepId} has more than one safety record.`, scenarioId: record.scenarioId });
    }
    cleanupRecordKeys.add(key);
    const expected = expectedCleanupByStep.get(key);
    if (expected === undefined) {
      diagnostics.push({ code: 'UNKNOWN_CLEANUP_SAFETY_RECORD', message: `Cleanup safety record ${record.id} does not identify a current cleanup step.`, scenarioId: record.scenarioId });
    } else if (stableSerialize(record) !== stableSerialize(expected)) {
      diagnostics.push({ code: 'ALTERED_CLEANUP_SAFETY_RECORD', message: `Cleanup safety record ${record.id} does not match the final workflow and evidence.`, scenarioId: record.scenarioId });
    }
    if (record.evidenceRevision !== evidence.revision) {
      diagnostics.push({ code: 'STALE_CLEANUP_SAFETY_RECORD', message: `Cleanup safety record ${record.id} uses a stale evidence revision.`, scenarioId: record.scenarioId });
    }
  }
  for (const expected of expectedCleanupRecords) {
    if (!cleanupRecordKeys.has(`${expected.scenarioId}:${expected.cleanupStepId}`)) {
      diagnostics.push({ code: 'MISSING_CLEANUP_SAFETY_RECORD', message: `Cleanup step ${expected.cleanupStepId} has no safety record.`, scenarioId: expected.scenarioId });
    }
  }
  let stepCount = 0;
  for (const scenario of workflow.scenarios) {
    const stepIds = new Set<string>();
    const stepsById = new Map<string, WorkflowStep>();
    for (const step of scenario.steps) {
      if (stepIds.has(step.id)) {
        diagnostics.push({ code: 'DUPLICATE_STEP_ID', message: `Workflow scenario ${scenario.id} contains duplicate step id ${step.id}.`, scenarioId: scenario.id });
      }
      stepIds.add(step.id);
      if (!stepsById.has(step.id)) stepsById.set(step.id, step);
    }
    if (hasDependencyCycle(scenario.steps)) {
      diagnostics.push({ code: 'CIRCULAR_VALUE_DEPENDENCY', message: `Workflow scenario ${scenario.id} contains a circular value dependency.`, scenarioId: scenario.id });
    }
    const seen = new Set<string>();
    for (const step of scenario.steps) {
      stepCount += 1;
      const operation = operations.get(step.operationId);
      if (operation === undefined) {
        diagnostics.push({ code: 'UNKNOWN_OPERATION', message: `Workflow step ${step.id} references unknown operation ${step.operationId}.`, scenarioId: scenario.id });
        continue;
      }
      if (operation.adapterId !== step.adapterId) {
        diagnostics.push({ code: 'ADAPTER_MISMATCH', message: `Workflow step ${step.id} adapter does not own operation ${operation.id}.`, scenarioId: scenario.id });
      }
      if (operation.capability !== step.capability) {
        diagnostics.push({ code: 'CAPABILITY_MISMATCH', message: `Workflow step ${step.id} capability does not match operation ${operation.id}.`, scenarioId: scenario.id });
      }
      if (stableSerialize(operation.provenance) !== stableSerialize(step.evidence)) {
        diagnostics.push({ code: 'EVIDENCE_PROVENANCE_MISMATCH', message: `Workflow step ${step.id} evidence does not match operation ${operation.id}.`, scenarioId: scenario.id });
      }
      const operationIssues = executableOperationIssues(operation);
      if (operationIssues.length > 0) {
        diagnostics.push(...operationIssues.map((message) => ({
          code: 'OPERATION_NOT_EXECUTABLE',
          message,
          scenarioId: scenario.id,
          operationIds: [operation.id],
        })));
      }
      const decision = decisionsByStep.get(`${scenario.id}:${step.id}`);
      if (decision === undefined) {
        diagnostics.push({ code: 'MISSING_SELECTION_DECISION', message: `Workflow step ${step.id} has no selection decision.`, scenarioId: scenario.id });
      } else {
        const decisionMatches = decision.selectedOperationId === step.operationId
          && decision.intentActionId === step.intentActionId
          && decision.phase === step.phase
          && stableSerialize(decision.expectedOutcomeIds) === stableSerialize(step.expectedOutcomeIds)
          && stableSerialize(decision.provenance) === stableSerialize(step.evidence)
          && decision.candidates.some((candidate) => candidate.operationId === step.operationId);
        if (!decisionMatches) diagnostics.push({ code: 'SELECTION_DECISION_MISMATCH', message: `Selection decision for step ${step.id} does not match the final workflow.`, scenarioId: scenario.id });
      }
      const cleanupListed = scenario.cleanupStepIds.includes(step.id);
      if ((step.phase === 'cleanup') !== cleanupListed) {
        diagnostics.push({ code: 'LIFECYCLE_PHASE_MISMATCH', message: `Workflow step ${step.id} cleanup phase and cleanup list disagree.`, scenarioId: scenario.id });
      }
      const declaredOutcomeIds = new Set(operation.outcomes.map((outcome) => outcome.id));
      if (new Set(step.expectedOutcomeIds).size !== step.expectedOutcomeIds.length
        || step.expectedOutcomeIds.some((outcomeId) => !declaredOutcomeIds.has(outcomeId))) {
        diagnostics.push({ code: 'UNPROVEN_WORKFLOW_OUTCOME', message: `Workflow step ${step.id} contains a duplicate or unevidenced outcome.`, scenarioId: scenario.id });
      }
      for (const dependency of step.dependsOn) {
        if (!stepIds.has(dependency) || !seen.has(dependency)) {
          diagnostics.push({ code: 'INVALID_DEPENDENCY_ORDER', message: `Workflow step ${step.id} depends on unavailable earlier step ${dependency}.`, scenarioId: scenario.id });
        }
      }
      const bound = new Set<string>();
      for (const binding of step.inputs) {
        if (bound.has(binding.inputSlotId)) {
          diagnostics.push({ code: 'DUPLICATE_INPUT_BINDING', message: `Workflow step ${step.id} binds input ${binding.inputSlotId} more than once.`, scenarioId: scenario.id });
        }
        bound.add(binding.inputSlotId);
        const inputSlot = operation.inputs.find((slot) => slot.id === binding.inputSlotId);
        if (inputSlot === undefined) {
          diagnostics.push({ code: 'UNKNOWN_INPUT_SLOT', message: `Workflow step ${step.id} binds unknown input ${binding.inputSlotId}.`, scenarioId: scenario.id });
          continue;
        }
        const edge = approvedTypeEdge(binding.value.semanticType, inputSlot.semanticType, operation);
        if (edge === undefined || !sameConversion(edge.conversion, binding.value.conversion)) {
          diagnostics.push({
            code: 'INCOMPATIBLE_VALUE_BINDING',
            message: `Workflow step ${step.id} has no adapter-approved type path for input ${inputSlot.name}.`,
            scenarioId: scenario.id,
            missingSemanticType: inputSlot.semanticType,
          });
        }
        if (binding.value.kind === 'intent' && containsObviousSecretLikeValue(binding.value.value)) {
          diagnostics.push({ code: 'RAW_SECRET_VALUE_FORBIDDEN', message: `Workflow step ${step.id} contains a raw secret-like value; use a secret reference instead.`, scenarioId: scenario.id });
        }
        if (binding.value.kind === 'output') {
          const outputValue = binding.value;
          const producer = stepsById.get(outputValue.stepId);
          const capture = producer?.captures.find((candidate) => candidate.outputSlotId === outputValue.outputSlotId);
          if (producer === undefined || capture === undefined) {
            diagnostics.push({ code: 'UNKNOWN_VALUE_PRODUCER', message: `Workflow step ${step.id} references an unavailable output producer.`, scenarioId: scenario.id });
          } else if (!seen.has(producer.id)) {
            diagnostics.push({ code: 'VALUE_PRODUCED_TOO_LATE', message: `Workflow step ${step.id} consumes a value before its producer ${producer.id}.`, scenarioId: scenario.id });
          } else if (normalizeSemanticType(capture.semanticType) !== normalizeSemanticType(outputValue.semanticType)) {
            diagnostics.push({ code: 'OUTPUT_TYPE_MISMATCH', message: `Workflow step ${step.id} records a producer type that does not match its captured output.`, scenarioId: scenario.id });
          }
        }
      }
      const captureIds = new Set<string>();
      for (const capture of step.captures) {
        if (captureIds.has(capture.outputSlotId)) {
          diagnostics.push({ code: 'DUPLICATE_OUTPUT_CAPTURE', message: `Workflow step ${step.id} captures output ${capture.outputSlotId} more than once.`, scenarioId: scenario.id });
        }
        captureIds.add(capture.outputSlotId);
        const outputSlot = operation.outputs.find((slot) => slot.id === capture.outputSlotId);
        if (outputSlot === undefined || normalizeSemanticType(outputSlot.semanticType) !== normalizeSemanticType(capture.semanticType)) {
          diagnostics.push({ code: 'INVALID_OUTPUT_CAPTURE', message: `Workflow step ${step.id} captures an unknown or incompatible output.`, scenarioId: scenario.id });
        }
      }
      for (const input of operation.inputs.filter((slot) => slot.required)) {
        if (!bound.has(input.id)) {
          diagnostics.push({
            code: 'UNBOUND_REQUIRED_INPUT',
            message: `Workflow step ${step.id} does not bind required input ${input.name}.`,
            scenarioId: scenario.id,
            missingSemanticType: input.semanticType,
          });
        }
      }
      if (scenario.cleanupPolicy === 'automatic' && operation.sideEffect === 'create') {
        const hasCleanup = operation.cleanupOperationId !== undefined
          && scenario.cleanupStepIds.some((cleanupId) => scenario.steps.find((candidate) => candidate.id === cleanupId)?.operationId === operation.cleanupOperationId);
        if (!hasCleanup) {
          diagnostics.push({
            code: 'MISSING_AUTOMATIC_CLEANUP',
            message: `Workflow step ${step.id} creates durable state but has no proven automatic cleanup operation.`,
            scenarioId: scenario.id,
            operationIds: [operation.id],
          });
        }
      }
      seen.add(step.id);
    }
  }
  if (workflow.selectionDecisions.length !== stepCount) {
    diagnostics.push({ code: 'SELECTION_DECISION_COUNT_MISMATCH', message: 'Workflow selection-decision count does not match its step count.' });
  }
  return diagnostics;
}

function sameConversion(left?: WorkflowValueConversion, right?: WorkflowValueConversion): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.id === right.id
    && left.adapterId === right.adapterId
    && normalizeSemanticType(left.fromSemanticType) === normalizeSemanticType(right.fromSemanticType)
    && normalizeSemanticType(left.toSemanticType) === normalizeSemanticType(right.toSemanticType)
    && left.safety === right.safety;
}

function hasDependencyCycle(steps: readonly WorkflowStep[]): boolean {
  const stepIds = new Set(steps.map((step) => step.id));
  const edges = new Map(steps.map((step) => [step.id, new Set([
    ...step.dependsOn,
    ...step.inputs.flatMap((input) => input.value.kind === 'output' ? [input.value.stepId] : []),
  ].filter((dependency) => stepIds.has(dependency)))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visiting.add(stepId);
    for (const dependency of edges.get(stepId) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  };
  return steps.some((step) => visit(step.id));
}

export function createEvidenceGraph(operations: readonly EvidenceOperation[], diagnostics: readonly string[] = []): EvidenceGraph {
  return {
    schemaVersion: 'brisk-aitesting.evidence-graph.v1',
    revision: `evidence_${randomUUID()}`,
    operations,
    diagnostics,
  };
}

function rankedCandidates(action: IntentAction, operations: readonly EvidenceOperation[]): readonly {
  readonly operation: EvidenceOperation;
  readonly score: number;
}[] {
  return operations
    .map((operation) => ({ operation, score: candidateScore(action, operation) }))
    .filter((candidate) => candidate.score >= 0.65)
    .sort((left, right) => right.score - left.score || left.operation.id.localeCompare(right.operation.id));
}

/** Uses the compiler's real candidate rule when evidence-change analysis asks
 * whether a changed operation could alter an intent action's selection. */
export function evidenceOperationMatchesIntentAction(action: IntentAction, operation: EvidenceOperation): boolean {
  return candidateScore(action, operation) >= 0.65;
}

function candidateScore(action: IntentAction, operation: EvidenceOperation): number {
  const actionVerb = canonicalVerb(action.verb);
  const operationVerb = canonicalVerb(operation.action);
  const verbScore = actionVerb === operationVerb ? 0.5 : tokenSimilarity(actionVerb, operationVerb) * 0.25;
  const resourceScore = tokenSimilarity(action.resource, operation.resource) * 0.4;
  const capabilityScore = action.capability === undefined ? 0.1 : action.capability === operation.capability ? 0.1 : -0.3;
  const actorScore = action.actor === undefined || operation.actor === undefined
    ? 0
    : tokenSimilarity(action.actor, operation.actor) * 0.1;
  return roundScore(verbScore + resourceScore + capabilityScore + actorScore);
}

function selectUnambiguousCandidate(candidates: readonly { readonly operation: EvidenceOperation; readonly score: number }[]): {
  readonly operation: EvidenceOperation;
  readonly score: number;
} | undefined {
  const first = candidates[0];
  if (first === undefined) return undefined;
  const second = candidates[1];
  if (second !== undefined && first.score - second.score < 0.1) return undefined;
  return first;
}

function executableOperationIssues(operation: EvidenceOperation): readonly string[] {
  const issues: string[] = [];
  if (operation.provenance.length === 0) issues.push(`Operation ${operation.id} has no provenance.`);
  if (operation.provenance.length > 0 && operation.provenance.every((entry) => entry.authority === 'heuristic')) {
    issues.push(`Operation ${operation.id} has heuristic-only evidence and cannot authorize execution.`);
  }
  if ((operation.conflicts?.length ?? 0) > 0) issues.push(`Operation ${operation.id} has unresolved evidence conflicts: ${operation.conflicts?.join('; ')}`);
  const authoritative = operation.provenance.some((entry) => MUTATION_AUTHORITIES.has(entry.authority));
  if (!['none', 'read'].includes(operation.sideEffect) && !authoritative) {
    issues.push(`Side-effecting operation ${operation.id} has no host, contract, runtime, or observed authority.`);
  }
  if (containsObviousSecretLikeValue(operation.binding)
    || operation.inputs.some((input) => input.generation?.kind === 'constant' && containsObviousSecretLikeValue(input.generation.value))) {
    issues.push(`Operation ${operation.id} contains a raw secret-like value in evidence. Use a secret reference instead.`);
  }
  const conversionIds = new Set<string>();
  for (const conversion of operation.valueConversions ?? []) {
    if (conversion.id.trim().length === 0
      || normalizeSemanticType(conversion.fromSemanticType).length === 0
      || normalizeSemanticType(conversion.toSemanticType).length === 0) {
      issues.push(`Operation ${operation.id} has an invalid value-conversion declaration.`);
    }
    if (conversionIds.has(conversion.id)) issues.push(`Operation ${operation.id} declares duplicate value conversion ${conversion.id}.`);
    conversionIds.add(conversion.id);
  }
  for (const input of operation.inputs) {
    if (input.secretRef !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.secretRef)) {
      issues.push(`Operation ${operation.id} input ${input.name} has an invalid secret reference name.`);
    }
    if (input.secretRef !== undefined && input.generation !== undefined) {
      issues.push(`Operation ${operation.id} input ${input.name} cannot declare both a secret reference and a generated value.`);
    }
  }
  const outcomes = new Map<string, EvidenceOperation['outcomes'][number]>();
  for (const outcome of operation.outcomes) {
    const prior = outcomes.get(outcome.id);
    if (outcome.id.trim().length === 0) issues.push(`Operation ${operation.id} declares a blank outcome identity.`);
    if (prior !== undefined) {
      const contradictory = prior.successful !== outcome.successful || prior.meaning !== outcome.meaning;
      issues.push(`Operation ${operation.id} declares ${contradictory ? 'contradictory' : 'duplicate'} outcome id ${outcome.id}.`);
    }
    outcomes.set(outcome.id, outcome);
  }
  return issues;
}

interface BindingResolution {
  readonly value?: WorkflowValueBinding;
  readonly code?: string;
  readonly reason?: string;
}

function bindInputs(
  action: IntentAction,
  operation: EvidenceOperation,
  available: readonly AvailableOutput[],
  diagnostics: CompilationDiagnostic[],
  scenarioId: string,
  preferredOutputStepId?: string,
): readonly WorkflowInputBinding[] | undefined {
  const bindings: WorkflowInputBinding[] = [];
  for (const input of operation.inputs) {
    if (normalizeSemanticType(input.semanticType).length === 0) {
      diagnostics.push({
        code: 'INVALID_SEMANTIC_TYPE',
        message: `Operation ${operation.id} input ${input.name} has a blank or malformed semantic type.`,
        scenarioId,
        actionId: action.id,
        operationIds: [operation.id],
      });
      return undefined;
    }
    const intentResolution = findIntentValue(action.values, input, operation);
    if (intentResolution.code !== undefined) {
      diagnostics.push({
        code: intentResolution.code,
        message: intentResolution.reason ?? `Operation ${operation.id} cannot safely bind ${input.name}.`,
        scenarioId,
        actionId: action.id,
        operationIds: [operation.id],
        missingSemanticType: input.semanticType,
      });
      return undefined;
    }
    const outputResolution = intentResolution.value === undefined
      ? bindFromAvailableOutput(input, available, operation, preferredOutputStepId)
      : undefined;
    if (outputResolution?.code !== undefined) {
      diagnostics.push({
        code: outputResolution.code,
        message: outputResolution.reason ?? `Operation ${operation.id} cannot safely bind ${input.name}.`,
        scenarioId,
        actionId: action.id,
        operationIds: [operation.id],
        missingSemanticType: input.semanticType,
      });
      return undefined;
    }
    const value = intentResolution.value ?? outputResolution?.value ?? bindGenerated(input);
    if (value === undefined) {
      if (input.required) {
        diagnostics.push({
          code: 'MISSING_REQUIRED_VALUE',
          message: `Operation ${operation.id} requires ${input.name} (${input.semanticType}), but no intent value, fixture, generator, or earlier output can provide it.`,
          scenarioId,
          actionId: action.id,
          operationIds: [operation.id],
          missingSemanticType: input.semanticType,
        });
        return undefined;
      }
      continue;
    }
    bindings.push({ inputSlotId: input.id, value });
  }
  return bindings;
}

function findIntentValue(
  values: IntentAction['values'],
  input: EvidenceValueSlot,
  operation: EvidenceOperation,
): BindingResolution {
  if (values === undefined) return {};
  const aliases = new Set([input.id, input.name, input.semanticType]);
  const named = Object.entries(values).filter(([key]) => aliases.has(key));
  if (named.length > 1) {
    return {
      code: 'DUPLICATE_INTENT_BINDING',
      reason: `More than one user-supplied alias targets ${input.name}; Brisk will not choose between them.`,
    };
  }
  const candidates = named.length === 1
    ? named
    : Object.entries(values).filter(([, value]) => approvedTypeEdge(value.semanticType, input.semanticType, operation) !== undefined);
  if (candidates.length > 1) {
    return {
      code: 'AMBIGUOUS_INTENT_BINDING',
      reason: `More than one user-supplied value can satisfy ${input.name}; name the intended input explicitly.`,
    };
  }
  const candidate = candidates[0];
  if (candidate === undefined) return {};
  const [, intentValue] = candidate;
  const edge = approvedTypeEdge(intentValue.semanticType, input.semanticType, operation);
  if (edge === undefined) {
    return {
      code: 'INCOMPATIBLE_VALUE_BINDING',
      reason: `The user supplied ${input.name}, but its semantic type is incompatible with ${input.semanticType}.`,
    };
  }
  if ('value' in intentValue && containsObviousSecretLikeValue(intentValue.value)) {
    return {
      code: 'RAW_SECRET_VALUE_FORBIDDEN',
      reason: `The user supplied a raw secret-like value for ${input.name}; pass a secret reference instead.`,
    };
  }
  const value = bindingFromIntentValue(intentValue, edge.conversion);
  return value === undefined ? {} : { value };
}

function bindingFromIntentValue(value: IntentValue, conversion?: WorkflowValueConversion): WorkflowValueBinding | undefined {
  if (value.secretRef !== undefined) return { kind: 'secret', semanticType: value.semanticType, secretRef: value.secretRef, ...(conversion === undefined ? {} : { conversion }) };
  if (value.fixture !== undefined) return { kind: 'fixture', semanticType: value.semanticType, fixture: value.fixture, ...(conversion === undefined ? {} : { conversion }) };
  if ('value' in value) return { kind: 'intent', semanticType: value.semanticType, value: value.value, ...(conversion === undefined ? {} : { conversion }) };
  return undefined;
}

function bindFromAvailableOutput(
  input: EvidenceValueSlot,
  available: readonly AvailableOutput[],
  operation: EvidenceOperation,
  preferredOutputStepId?: string,
): BindingResolution {
  const candidates = available.flatMap((entry) => {
    const edge = approvedTypeEdge(entry.slot.semanticType, input.semanticType, operation);
    return edge === undefined ? [] : [{ entry, edge }];
  });
  const semanticOwner = normalizeSemanticType(input.semanticType).split('.')[0];
  const ownerCreateCandidates = candidates.filter(({ entry }) => (
    normalizeSemanticType(entry.operation.resource) === semanticOwner
    && entry.operation.sideEffect === 'create'
  ));
  const preferredCandidates = preferredOutputStepId === undefined
    ? []
    : candidates.filter(({ entry }) => entry.stepId === preferredOutputStepId);
  const narrowed = preferredCandidates.length > 0
    ? preferredCandidates
    : ownerCreateCandidates.length === 1 ? ownerCreateCandidates : candidates;
  if (narrowed.length > 1) {
    return {
      code: 'AMBIGUOUS_VALUE_PRODUCER',
      reason: `More than one earlier output can provide ${input.name}; Brisk will not guess which producer is intended.`,
    };
  }
  const selected = narrowed[0];
  // An incompatible earlier output may simply be unrelated. It is not a
  // binding until selected, so a declared generator may still satisfy input.
  if (selected === undefined) return {};
  return { value: {
    kind: 'output',
    semanticType: selected.entry.slot.semanticType,
    stepId: selected.entry.stepId,
    outputSlotId: selected.entry.slot.id,
    ...(selected.edge.conversion === undefined ? {} : { conversion: selected.edge.conversion }),
  } };
}

function bindGenerated(input: EvidenceValueSlot): WorkflowValueBinding | undefined {
  if (input.secretRef !== undefined) {
    return { kind: 'secret', semanticType: input.semanticType, secretRef: input.secretRef };
  }
  if (input.generation === undefined) return undefined;
  return {
    kind: 'generated',
    semanticType: input.semanticType,
    generation: input.generation,
  };
}

function resolveOutcomes(
  action: IntentAction,
  operation: EvidenceOperation,
  diagnostics: CompilationDiagnostic[],
  scenarioId: string,
): readonly string[] | undefined {
  if (action.expectedOutcomes.length === 0) {
    return operation.outcomes.filter((outcome) => outcome.successful).map((outcome) => outcome.id);
  }
  const resolved: string[] = [];
  for (const expected of action.expectedOutcomes) {
    const exact = operation.outcomes.find((outcome) => outcome.id === expected);
    if (exact !== undefined) {
      resolved.push(exact.id);
      continue;
    }
    const matches = operation.outcomes
      .map((outcome) => ({ outcome, score: tokenSimilarity(expected, outcome.meaning) }))
      .filter((candidate) => candidate.score >= 0.45)
      .sort((left, right) => right.score - left.score);
    const top = matches[0];
    const second = matches[1];
    const selected = second !== undefined && top !== undefined && top.score === second.score ? undefined : top?.outcome;
    if (selected === undefined) {
      diagnostics.push({
        code: 'UNPROVEN_EXPECTED_OUTCOME',
        message: `Operation ${operation.id} does not declare an outcome matching "${expected}".`,
        scenarioId,
        actionId: action.id,
        operationIds: [operation.id],
      });
      return undefined;
    }
    resolved.push(selected.id);
  }
  return [...new Set(resolved)];
}

function synthesizeCleanupSteps(params: {
  readonly scenarioId: string;
  readonly cleanupPolicy: 'automatic' | 'isolated' | 'manual';
  readonly steps: WorkflowStep[];
  readonly available: readonly AvailableOutput[];
  readonly evidence: EvidenceGraph;
  readonly diagnostics: CompilationDiagnostic[];
}): readonly string[] {
  if (params.cleanupPolicy !== 'automatic') return [];
  const operations = new Map(params.evidence.operations.map((operation) => [operation.id, operation]));
  const originalSteps = [...params.steps];
  const originalStepsById = new Map(originalSteps.map((step) => [step.id, step]));
  const sourceSteps = originalSteps.filter((step) => operations.get(step.operationId)?.sideEffect === 'create').reverse();
  const sourceStepIds = new Set(sourceSteps.map((step) => step.id));
  const cleanupBySourceStepId = new Map<string, WorkflowStep>();
  const synthesizedCleanupIds = new Set<string>();
  const claimedExistingCleanupIds = new Set<string>();

  for (const sourceStep of sourceSteps) {
    const sourceOperation = operations.get(sourceStep.operationId);
    if (sourceOperation === undefined) continue;
    const cleanupOperationId = sourceOperation.cleanupOperationId;
    if (cleanupOperationId === undefined) {
      params.diagnostics.push({
        code: 'MISSING_CLEANUP_OPERATION',
        message: `Operation ${sourceOperation.id} creates durable state but declares no cleanup operation.`,
        scenarioId: params.scenarioId,
        operationIds: [sourceOperation.id],
      });
      continue;
    }
    const existing = originalSteps.find((step) => (
      step.phase === 'cleanup'
      && step.operationId === cleanupOperationId
      && step.dependsOn.includes(sourceStep.id)
      && !claimedExistingCleanupIds.has(step.id)
    ));
    if (existing !== undefined) {
      claimedExistingCleanupIds.add(existing.id);
      cleanupBySourceStepId.set(sourceStep.id, existing);
      continue;
    }
    const cleanupOperation = operations.get(cleanupOperationId);
    if (cleanupOperation === undefined) {
      params.diagnostics.push({
        code: 'UNKNOWN_CLEANUP_OPERATION',
        message: `Operation ${sourceOperation.id} references missing cleanup operation ${cleanupOperationId}.`,
        scenarioId: params.scenarioId,
        operationIds: [sourceOperation.id, cleanupOperationId],
      });
      continue;
    }
    const operationIssues = executableOperationIssues(cleanupOperation);
    if (operationIssues.length > 0) {
      params.diagnostics.push(...operationIssues.map((message) => ({
        code: 'CLEANUP_OPERATION_NOT_EXECUTABLE',
        message,
        scenarioId: params.scenarioId,
        operationIds: [cleanupOperation.id],
      })));
      continue;
    }
    const syntheticAction: IntentAction = {
      id: `cleanup_${sourceStep.intentActionId}`,
      verb: cleanupOperation.action,
      resource: cleanupOperation.resource,
      expectedOutcomes: [],
    };
    const inputs = bindInputs(
      syntheticAction,
      cleanupOperation,
      params.available,
      params.diagnostics,
      params.scenarioId,
      sourceStep.id,
    );
    if (inputs === undefined) continue;
    const cleanupStepId = `step_cleanup_${sanitizeId(sourceStep.id)}`;
    const dependencies = [...new Set([
      sourceStep.id,
      ...inputs
        .map((input) => input.value.kind === 'output' ? input.value.stepId : undefined)
        .filter((step): step is string => step !== undefined),
    ])];
    const cleanupStep: WorkflowStep = {
      id: cleanupStepId,
      intentActionId: syntheticAction.id,
      operationId: cleanupOperation.id,
      adapterId: cleanupOperation.adapterId,
      capability: cleanupOperation.capability,
      phase: 'cleanup',
      inputs,
      captures: cleanupOperation.outputs.map((slot) => ({
        outputSlotId: slot.id,
        semanticType: slot.semanticType,
      })),
      dependsOn: dependencies,
      expectedOutcomeIds: cleanupOperation.outcomes.filter((outcome) => outcome.successful).map((outcome) => outcome.id),
      evidence: cleanupOperation.provenance,
      sideEffect: cleanupOperation.sideEffect,
    };
    cleanupBySourceStepId.set(sourceStep.id, cleanupStep);
    synthesizedCleanupIds.add(cleanupStepId);
  }

  const dependantCleanupIdsBySource = new Map<string, string[]>();
  for (const childSource of sourceSteps) {
    const childCleanup = cleanupBySourceStepId.get(childSource.id);
    if (childCleanup === undefined) continue;
    for (const parentSourceId of nearestCreatedDependencies(childSource, sourceStepIds, originalStepsById)) {
      const dependants = dependantCleanupIdsBySource.get(parentSourceId) ?? [];
      dependants.push(childCleanup.id);
      dependantCleanupIdsBySource.set(parentSourceId, dependants);
    }
  }

  const cleanupIds: string[] = [];
  for (const sourceStep of sourceSteps) {
    const cleanupStep = cleanupBySourceStepId.get(sourceStep.id);
    if (cleanupStep === undefined) continue;
    const dependantCleanupIds = dependantCleanupIdsBySource.get(sourceStep.id) ?? [];
    if (synthesizedCleanupIds.has(cleanupStep.id)) {
      params.steps.push({
        ...cleanupStep,
        dependsOn: [...new Set([...cleanupStep.dependsOn, ...dependantCleanupIds])],
      });
    }
    cleanupIds.push(cleanupStep.id);
  }
  return cleanupIds;
}

function nearestCreatedDependencies(
  step: WorkflowStep,
  createdStepIds: ReadonlySet<string>,
  stepsById: ReadonlyMap<string, WorkflowStep>,
): readonly string[] {
  const found: string[] = [];
  const visited = new Set<string>();
  const pending = [...step.dependsOn];
  while (pending.length > 0) {
    const dependencyId = pending.shift();
    if (dependencyId === undefined || visited.has(dependencyId)) continue;
    visited.add(dependencyId);
    if (createdStepIds.has(dependencyId)) {
      found.push(dependencyId);
      continue;
    }
    pending.push(...(stepsById.get(dependencyId)?.dependsOn ?? []));
  }
  return [...new Set(found)];
}

function compilationStatus(diagnostics: readonly CompilationDiagnostic[]): CompilationResult['status'] {
  if (diagnostics.length === 0) return 'compiled';
  if (diagnostics.some((diagnostic) => diagnostic.code === 'AMBIGUOUS_OPERATION')) return 'ambiguous';
  if (diagnostics.every((diagnostic) => diagnostic.code === 'NO_OPERATION_FOR_INTENT')) return 'unsupported';
  return 'needs-evidence';
}

function approvedTypeEdge(
  producer: string,
  consumer: string,
  operation: EvidenceOperation,
): { readonly conversion?: WorkflowValueConversion } | undefined {
  const from = normalizeSemanticType(producer);
  const to = normalizeSemanticType(consumer);
  if (from.length === 0 || to.length === 0) return undefined;
  if (from === to) return {};
  const matches = (operation.valueConversions ?? []).filter((conversion) => (
    normalizeSemanticType(conversion.fromSemanticType) === from
    && normalizeSemanticType(conversion.toSemanticType) === to
  ));
  if (matches.length !== 1) return undefined;
  const conversion = matches[0];
  if (conversion === undefined) return undefined;
  return {
    conversion: {
      id: conversion.id,
      adapterId: operation.adapterId,
      fromSemanticType: conversion.fromSemanticType,
      toSemanticType: conversion.toSemanticType,
      safety: conversion.safety,
    },
  };
}

function canonicalVerb(value: string): string {
  const normalized = normalizeWords(value).join(' ');
  for (const [canonical, aliases] of Object.entries(VERB_ALIASES)) {
    if (aliases.includes(normalized)) return canonical;
  }
  return normalized;
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeWords(left));
  const rightTokens = new Set(normalizeWords(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function normalizeWords(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singularize);
}

function singularize(value: string): string {
  if (value.endsWith('ies') && value.length > 3) return `${value.slice(0, -3)}y`;
  if (value.endsWith('s') && !value.endsWith('ss') && value.length > 3) return value.slice(0, -1);
  return value;
}

function normalizeSemanticType(value: string): string {
  return normalizeWords(value).join('.');
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
