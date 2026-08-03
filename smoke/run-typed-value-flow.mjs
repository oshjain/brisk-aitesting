import assert from 'node:assert/strict';
import {
  AiIntentPlanner,
  UniversalSemanticCompiler,
  containsObviousSecretLikeValue,
  createEvidenceGraph,
  validateWorkflowInvariants,
} from '../dist/index.js';

const categories = {};
let checks = 0;
const check = (category, condition, message) => {
  assert.equal(condition, true, message);
  categories[category] = (categories[category] ?? 0) + 1;
  checks += 1;
};
const compiler = new UniversalSemanticCompiler();
const provenance = [{ authority: 'contract', source: 'typed-value-flow-fixture', confidence: 1 }];
const slot = (id, semanticType, options = {}) => ({ id, name: options.name ?? id, semanticType, required: options.required ?? true, ...(options.generation === undefined ? {} : { generation: options.generation }), ...(options.secretRef === undefined ? {} : { secretRef: options.secretRef }) });
const operation = (value) => ({
  inputs: [], outputs: [], outcomes: [{ id: 'ok', meaning: 'succeeds', successful: true }],
  sideEffect: 'none', provenance, binding: { fixture: true }, ...value,
});
const intent = (actions, goal = 'Prove typed value flow') => ({
  schemaVersion: 'brisk-aitesting.intent.v1', goal, warnings: [], scenarios: [{
    id: 'typed_values', name: 'Typed values', objective: goal, actions: actions.map((action, index) => ({ id: `action_${index + 1}`, expectedOutcomes: [], ...action })),
    invariants: [], evidenceRequired: [], cleanup: 'isolated',
  }],
});

const sourceEvidence = createEvidenceGraph([
  operation({ id: 'widget.create', adapterId: 'fixture', capability: 'custom.fixture', name: 'Create widget', action: 'create', resource: 'widget', sideEffect: 'create', outputs: [slot('widgetId', 'widget.id', { required: false })] }),
  operation({ id: 'profile.submit', adapterId: 'fixture', capability: 'custom.fixture', name: 'Submit profile', action: 'submit', resource: 'profile', inputs: [
    slot('widgetId', 'widget.id'), slot('name', 'profile.name'), slot('fixture', 'profile.fixture'), slot('token', 'auth.token'),
    slot('requestId', 'request.id', { generation: { kind: 'uuid' } }),
  ] }),
  operation({ id: 'widget.verify', adapterId: 'fixture', capability: 'custom.fixture', name: 'Verify widget', action: 'verify', resource: 'widget audit', sideEffect: 'read', inputs: [slot('widgetId', 'widget.id')] }),
]);
const sourceResult = compiler.compile(intent([
  { verb: 'create', resource: 'widget' },
  { verb: 'submit', resource: 'profile', values: {
    name: { semanticType: 'profile.name', value: 'Ada' },
    fixture: { semanticType: 'profile.fixture', fixture: 'standard-profile' },
    token: { semanticType: 'auth.token', secretRef: 'PROFILE_AUTH_TOKEN' },
  } },
  { verb: 'verify', resource: 'widget audit' },
]), sourceEvidence);
check('fiveSources', sourceResult.status === 'compiled', JSON.stringify(sourceResult.diagnostics));
const sourceScenario = sourceResult.workflow?.scenarios[0];
check('fiveSources', sourceScenario?.valueFlow?.schemaVersion === 'brisk-aitesting.value-flow.v1');
const sourceKinds = new Set(sourceScenario?.valueFlow?.values.map((value) => value.source.kind));
for (const kind of ['intent', 'fixture', 'secret-reference', 'generated', 'step-output']) check('fiveSources', sourceKinds.has(kind), `missing ${kind}`);
check('fiveSources', sourceScenario?.valueFlow?.values.every((value) => value.semanticType.length > 0) === true);
check('consumersAndLifetime', sourceScenario?.valueFlow?.values.every((value) => value.consumers.length > 0) === true);
const sharedOutput = sourceScenario?.valueFlow?.values.find((value) => value.source.kind === 'step-output');
check('consumersAndLifetime', sharedOutput?.consumers.length === 2);
check('consumersAndLifetime', sharedOutput?.lifetime.startsAt === 'after:step_action_1_1');
check('consumersAndLifetime', sharedOutput?.lifetime.endsAt === 'after:step_action_3_3');
check('secretSafety', sourceScenario?.valueFlow?.values.find((value) => value.secret)?.source.reference === 'PROFILE_AUTH_TOKEN');
check('secretSafety', !JSON.stringify(sourceScenario?.valueFlow).includes('actual-secret-value'));

const conversionEvidence = createEvidenceGraph([
  operation({ id: 'legacy.create', adapterId: 'conversion-adapter', capability: 'custom.fixture', name: 'Create legacy customer', action: 'create', resource: 'legacy', sideEffect: 'create', outputs: [slot('legacyId', 'legacy.id', { required: false })] }),
  operation({ id: 'customer.read', adapterId: 'conversion-adapter', capability: 'custom.fixture', name: 'Read customer', action: 'read', resource: 'customer', sideEffect: 'read', inputs: [slot('customerId', 'customer.id')], valueConversions: [{ id: 'legacy-to-customer-id', fromSemanticType: 'legacy.id', toSemanticType: 'customer.id', safety: 'validated', binding: { adapterOwned: true } }] }),
]);
const converted = compiler.compile(intent([{ verb: 'create', resource: 'legacy' }, { verb: 'read', resource: 'customer' }]), conversionEvidence);
check('adapterConversion', converted.status === 'compiled', JSON.stringify(converted.diagnostics));
const convertedBinding = converted.workflow?.scenarios[0]?.steps[1]?.inputs[0]?.value;
check('adapterConversion', convertedBinding?.conversion?.id === 'legacy-to-customer-id');
check('adapterConversion', convertedBinding?.conversion?.adapterId === 'conversion-adapter');
check('adapterConversion', converted.workflow?.scenarios[0]?.valueFlow?.values.some((value) => value.consumers.some((consumer) => consumer.conversion?.id === 'legacy-to-customer-id')) === true);

const noConversion = compiler.compile(intent([{ verb: 'create', resource: 'legacy' }, { verb: 'read', resource: 'customer' }]), createEvidenceGraph(conversionEvidence.operations.map((entry) => ({ ...entry, valueConversions: undefined }))));
check('adapterConversion', noConversion.status === 'needs-evidence');
check('adapterConversion', noConversion.diagnostics.some((entry) => entry.code === 'MISSING_REQUIRED_VALUE'));

const incompatible = compiler.compile(intent([{ verb: 'read', resource: 'customer', values: { customerId: { semanticType: 'order.id', value: 'order-1' } } }]), createEvidenceGraph([conversionEvidence.operations[1]]));
check('bindingRejections', incompatible.status === 'needs-evidence');
check('bindingRejections', incompatible.diagnostics.some((entry) => entry.code === 'INCOMPATIBLE_VALUE_BINDING'));
const duplicate = compiler.compile(intent([{ verb: 'read', resource: 'customer', values: {
  customerId: { semanticType: 'customer.id', value: 'customer-1' },
  'customer.id': { semanticType: 'customer.id', value: 'customer-2' },
} }]), createEvidenceGraph([conversionEvidence.operations[1]]));
check('bindingRejections', duplicate.status === 'needs-evidence');
check('bindingRejections', duplicate.diagnostics.some((entry) => entry.code === 'DUPLICATE_INTENT_BINDING'));
const missing = compiler.compile(intent([{ verb: 'read', resource: 'customer' }]), createEvidenceGraph([conversionEvidence.operations[1]]));
check('bindingRejections', missing.diagnostics.some((entry) => entry.code === 'MISSING_REQUIRED_VALUE'));

const ambiguousProducer = compiler.compile(intent([
  { verb: 'create', resource: 'customer' }, { verb: 'create', resource: 'customer' }, { verb: 'read', resource: 'customer' },
]), createEvidenceGraph([
  operation({ id: 'customer.create', adapterId: 'fixture', capability: 'custom.fixture', name: 'Create customer', action: 'create', resource: 'customer', sideEffect: 'create', outputs: [slot('customerId', 'customer.id', { required: false })] }),
  operation({ id: 'customer.read', adapterId: 'fixture', capability: 'custom.fixture', name: 'Read customer', action: 'read', resource: 'customer', sideEffect: 'read', inputs: [slot('customerId', 'customer.id')] }),
]));
check('bindingRejections', ambiguousProducer.status === 'needs-evidence');
check('bindingRejections', ambiguousProducer.diagnostics.some((entry) => entry.code === 'AMBIGUOUS_VALUE_PRODUCER'));

const rawSecret = 'sk-abcdefghijklmnop';
const rawSecretResult = compiler.compile(intent([{ verb: 'read', resource: 'customer', values: { customerId: { semanticType: 'customer.id', value: rawSecret } } }]), createEvidenceGraph([conversionEvidence.operations[1]]));
check('secretSafety', rawSecretResult.diagnostics.some((entry) => entry.code === 'RAW_SECRET_VALUE_FORBIDDEN'));
check('secretSafety', !JSON.stringify(rawSecretResult.diagnostics).includes(rawSecret));
const secretEvidence = compiler.compile(intent([{ verb: 'read', resource: 'customer', values: { customerId: { semanticType: 'customer.id', value: 'customer-1' } } }]), createEvidenceGraph([{ ...conversionEvidence.operations[1], binding: { authorization: 'Bearer abcdefghijklmnop' } }]));
check('secretSafety', secretEvidence.diagnostics.some((entry) => entry.code === 'OPERATION_NOT_EXECUTABLE'));
check('secretSafety', !JSON.stringify(secretEvidence.diagnostics).includes('abcdefghijklmnop'));
check('secretSafety', containsObviousSecretLikeValue({ password: 'plain-text-password' }));

const evidenceSecretResult = compiler.compile(intent([{ verb: 'authorize', resource: 'cleanup' }]), createEvidenceGraph([
  operation({ id: 'cleanup.authorize', adapterId: 'fixture', capability: 'api.http', name: 'Authorize cleanup', action: 'authorize', resource: 'cleanup', inputs: [slot('authorization', 'auth.bearer', { secretRef: 'BRISK_CLEANUP_AUTHORIZATION' })] }),
]));
check('secretSafety', evidenceSecretResult.status === 'compiled', JSON.stringify(evidenceSecretResult.diagnostics));
check('secretSafety', evidenceSecretResult.workflow?.scenarios[0]?.steps[0]?.inputs[0]?.value.kind === 'secret');
check('secretSafety', evidenceSecretResult.workflow?.scenarios[0]?.valueFlow?.values[0]?.source.reference === 'BRISK_CLEANUP_AUTHORIZATION');
const invalidEvidenceSecret = compiler.compile(intent([{ verb: 'authorize', resource: 'cleanup' }]), createEvidenceGraph([
  operation({ id: 'cleanup.invalid-secret', adapterId: 'fixture', capability: 'api.http', name: 'Invalid cleanup secret', action: 'authorize', resource: 'cleanup', inputs: [slot('authorization', 'auth.bearer', { secretRef: 'not valid' })] }),
]));
check('secretSafety', invalidEvidenceSecret.diagnostics.some((entry) => entry.code === 'OPERATION_NOT_EXECUTABLE'));

let providerCalls = 0;
const aiPlanner = new AiIntentPlanner({ name: 'must-not-run', async complete() { providerCalls += 1; throw new Error('provider must not receive secret'); } });
await assert.rejects(() => aiPlanner.plan({
  config: { app: { name: 'fixture', env: 'test' } },
  input: { goal: `Inspect with Bearer abcdefghijklmnop` }, runId: 'run_secret', discovery: {},
}, sourceEvidence), /raw secret-like value/);
check('secretSafety', providerCalls === 0);

const malformedType = compiler.compile(intent([{ verb: 'read', resource: 'broken' }]), createEvidenceGraph([
  operation({ id: 'broken.read', adapterId: 'fixture', capability: 'custom.fixture', name: 'Broken read', action: 'read', resource: 'broken', inputs: [slot('broken', '!!!')] }),
]));
check('typeValidation', malformedType.diagnostics.some((entry) => entry.code === 'INVALID_SEMANTIC_TYPE'));
const duplicateConversion = compiler.compile(intent([{ verb: 'read', resource: 'customer', values: { customerId: { semanticType: 'legacy.id', value: 'legacy-1' } } }]), createEvidenceGraph([{ ...conversionEvidence.operations[1], valueConversions: [
  { id: 'same', fromSemanticType: 'legacy.id', toSemanticType: 'customer.id', safety: 'lossless' },
  { id: 'same', fromSemanticType: 'legacy.id', toSemanticType: 'customer.id', safety: 'lossless' },
] }]));
check('typeValidation', duplicateConversion.diagnostics.some((entry) => entry.code === 'OPERATION_NOT_EXECUTABLE'));

const validWorkflow = structuredClone(sourceResult.workflow);
const cycleSteps = validWorkflow.scenarios[0].steps;
cycleSteps[0].dependsOn = [cycleSteps[1].id];
cycleSteps[1].dependsOn = [cycleSteps[0].id];
const cycleDiagnostics = validateWorkflowInvariants(validWorkflow, sourceEvidence);
check('graphInvariants', cycleDiagnostics.some((entry) => entry.code === 'CIRCULAR_VALUE_DEPENDENCY'));
const duplicateStepWorkflow = structuredClone(sourceResult.workflow);
duplicateStepWorkflow.scenarios[0].steps[1].id = duplicateStepWorkflow.scenarios[0].steps[0].id;
check('graphInvariants', validateWorkflowInvariants(duplicateStepWorkflow, sourceEvidence).some((entry) => entry.code === 'DUPLICATE_STEP_ID'));
const duplicateInputWorkflow = structuredClone(sourceResult.workflow);
duplicateInputWorkflow.scenarios[0].steps[1].inputs.push(structuredClone(duplicateInputWorkflow.scenarios[0].steps[1].inputs[0]));
check('graphInvariants', validateWorkflowInvariants(duplicateInputWorkflow, sourceEvidence).some((entry) => entry.code === 'DUPLICATE_INPUT_BINDING'));
const unknownProducerWorkflow = structuredClone(sourceResult.workflow);
unknownProducerWorkflow.scenarios[0].steps[1].inputs[0].value.stepId = 'missing-step';
check('graphInvariants', validateWorkflowInvariants(unknownProducerWorkflow, sourceEvidence).some((entry) => entry.code === 'UNKNOWN_VALUE_PRODUCER'));
const lateProducerWorkflow = structuredClone(sourceResult.workflow);
lateProducerWorkflow.scenarios[0].steps[0].inputs = [{ inputSlotId: 'invented', value: { kind: 'output', semanticType: 'widget.id', stepId: lateProducerWorkflow.scenarios[0].steps[2].id, outputSlotId: 'widgetId' } }];
check('graphInvariants', validateWorkflowInvariants(lateProducerWorkflow, sourceEvidence).some((entry) => entry.code === 'VALUE_PRODUCED_TOO_LATE' || entry.code === 'UNKNOWN_INPUT_SLOT'));

console.log(JSON.stringify({
  schemaVersion: 'brisk-aitesting.typed-value-flow-smoke.v1',
  categories,
  checks,
  failures: 0,
  skips: 0,
}, null, 2));
