import type { EvidenceGraph, IntentPlan } from './compiler-types.js';
import type { AiPlannerProvider, PlannerContext } from './types.js';
import { containsObviousSecretLikeValue } from './secret-safety.js';

const CAPABILITIES = ['web.ui', 'api.http', 'api.graphql', 'api.grpc', 'messaging', 'data', 'job', 'cli', 'code'] as const;

export const aiIntentOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenarios', 'warnings'],
  properties: {
    scenarios: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'objective', 'actions', 'invariants', 'evidenceRequired', 'cleanup'],
        properties: {
          id: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          objective: { type: 'string', minLength: 1 },
          actor: { type: 'string', minLength: 1 },
          initialState: { type: 'array', items: { type: 'string', minLength: 1 } },
          actions: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'verb', 'resource', 'expectedOutcomes'],
              properties: {
                id: { type: 'string', minLength: 1 },
                verb: { type: 'string', minLength: 1 },
                resource: { type: 'string', minLength: 1 },
                capability: { enum: CAPABILITIES },
                actor: { type: 'string', minLength: 1 },
                phase: { enum: ['setup', 'test', 'verification'] },
                values: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['semanticType'],
                    properties: {
                      semanticType: { type: 'string', minLength: 1 },
                      value: {},
                      fixture: { type: 'string', minLength: 1 },
                      secretRef: { type: 'string', minLength: 1 },
                      fromActionId: { type: 'string', minLength: 1 },
                    },
                  },
                },
                expectedOutcomes: { type: 'array', items: { type: 'string', minLength: 1 } },
              },
            },
          },
          invariants: { type: 'array', items: { type: 'string', minLength: 1 } },
          evidenceRequired: { type: 'array', items: { type: 'string', minLength: 1 } },
          cleanup: { enum: ['automatic', 'isolated', 'manual'] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export class AiIntentPlanner {
  readonly name = 'ai-intent-planner';

  constructor(private readonly provider: AiPlannerProvider) {}

  async plan(context: PlannerContext, evidence: EvidenceGraph): Promise<IntentPlan> {
    const maxRepairAttempts = normalizeRepairAttempts(context.config.planning?.repairAttempts ?? context.config.ai?.repairAttempts);
    let invalidContent = '';
    let lastError = 'AI intent was not accepted.';
    for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
      const userPrompt = attempt === 0
        ? intentUserPrompt(context, evidence)
        : intentRepairUserPrompt(context, evidence, invalidContent, lastError, attempt, maxRepairAttempts);
      if (containsObviousSecretLikeValue(userPrompt)) {
        throw new Error('AI intent prompt rejected because it contains a raw secret-like value. Pass a secret reference instead.');
      }
      const response = await this.provider.complete({
        jsonSchemaName: 'brisk-aitesting.intent.v1',
        jsonSchema: aiIntentOutputJsonSchema,
        structuredOutput: 'json-schema',
        system: attempt === 0 ? intentSystemPrompt() : intentRepairSystemPrompt(),
        user: userPrompt,
      });
      invalidContent = response.content;
      try {
        return parseIntent(response.content, context);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`AI intent remained invalid after ${maxRepairAttempts} repair attempt(s): ${lastError}`);
  }

  async repairSemantic(
    context: PlannerContext,
    evidence: EvidenceGraph,
    invalidIntent: IntentPlan,
    diagnostics: readonly { readonly code: string; readonly message: string; readonly scenarioId?: string; readonly actionId?: string }[],
    attempt: number,
    maxAttempts: number,
  ): Promise<IntentPlan> {
    const user = JSON.stringify({
      task: 'Repair business intent that is valid JSON but cannot compile unambiguously against the supplied application abilities.',
      attempt,
      maxAttempts,
      rules: [
        'Keep every requested area of coverage; do not silently remove a scenario or action.',
        'For AMBIGUOUS_OPERATION, select one exact action/resource/capability combination from semanticVocabulary.operations.',
        'For missing or ambiguous values, use values.<input>.fromActionId with the exact earlier action id and semantic type.',
        'Do not invent an operation, input, output, route, selector, payload field, or status code.',
      ],
      diagnostics,
      invalidIntent,
      originalRequest: JSON.parse(intentUserPrompt(context, evidence)) as unknown,
    });
    if (containsObviousSecretLikeValue(user)) {
      throw new Error('AI semantic repair prompt rejected because it contains a raw secret-like value. Pass a secret reference instead.');
    }
    const response = await this.provider.complete({
      jsonSchemaName: 'brisk-aitesting.intent.v1',
      jsonSchema: aiIntentOutputJsonSchema,
      structuredOutput: 'json-schema',
      system: [intentRepairSystemPrompt(), 'Fix compiler ambiguity and typed value relationships without reducing requested coverage.'].join('\n'),
      user,
    });
    return parseIntent(response.content, context);
  }
}

export function parseAiIntentForTesting(content: string, context: PlannerContext): IntentPlan {
  return parseIntent(content, context);
}

function intentSystemPrompt(): string {
  return [
    'You translate a software-testing goal into protocol-neutral business intent.',
    'Return only the requested structured JSON.',
    'Describe what the user wants proven; never describe how an engine should execute it.',
    'Do not output URLs, routes, HTTP methods, selectors, queries, payload field names, status codes, capture paths, scripts, commands, broker addresses, or engine names.',
    'Use only semantic actions: a verb, a business resource, optional actor, and expected business outcomes.',
    'When an action needs a value produced by one specific earlier action, set values.<input>.semanticType and values.<input>.fromActionId to that earlier action id.',
    'Use fromActionId whenever more than one earlier action creates the same resource type; never leave that relationship ambiguous.',
    'For expectedOutcomes, copy only exact outcome ids supplied in the application evidence vocabulary.',
    'Use setup or verification phase only when the user explicitly asks for that role; otherwise omit phase and the compiler will use test.',
    'The deterministic compiler—not you—selects operations, constructs inputs, binds values, derives executable assertions, and plans cleanup.',
    'Use the semantic capability and resource vocabulary supplied by the application evidence.',
    'Do not invent a capability or resource absent from the supplied vocabulary.',
    'When the requested scenario count policy is exact, return exactly that many scenarios.',
  ].join('\n');
}

function intentRepairSystemPrompt(): string {
  return [
    intentSystemPrompt(),
    'Repair the previous response using the supplied validation error.',
    'Every scenario must contain at least one action.',
    'Every action must contain at least one expected business outcome when the supplied vocabulary provides one.',
    'Preserve valid scenarios and change only what the validation error requires.',
    'Return the complete repaired JSON object, not a patch or explanation.',
  ].join('\n');
}

function intentUserPrompt(context: PlannerContext, evidence: EvidenceGraph): string {
  const vocabulary = {
    capabilities: [...new Set(evidence.operations.map((operation) => operation.capability))].sort(),
    resources: [...new Set(evidence.operations.map((operation) => operation.resource))].sort(),
    actions: [...new Set(evidence.operations.map((operation) => operation.action))].sort(),
    actors: [...new Set(evidence.operations.map((operation) => operation.actor).filter((actor): actor is string => actor !== undefined))].sort(),
    outcomes: evidence.operations.map((operation) => ({
      action: operation.action,
      resource: operation.resource,
      ids: operation.outcomes.map((outcome) => outcome.id),
    })),
    operations: evidence.operations.map((operation) => ({
      action: operation.action,
      resource: operation.resource,
      capability: operation.capability,
      requiredInputs: operation.inputs.filter((input) => input.required).map((input) => ({
        name: input.name,
        semanticType: input.semanticType,
        generatedWhenOmitted: input.generation !== undefined,
      })),
      outputs: operation.outputs.map((output) => ({ name: output.name, semanticType: output.semanticType })),
      outcomeIds: operation.outcomes.map((outcome) => outcome.id),
    })),
  };
  return JSON.stringify({
    goal: context.input.goal,
    requestedScenarios: context.input.scenarios ?? 5,
    scenarioCountPolicy: context.input.scenarioCountPolicy ?? 'flexible',
    requestedCapabilityTypes: context.input.requiredTypes ?? [],
    application: {
      name: context.config.app.name,
      environment: context.config.app.env,
    },
    semanticVocabulary: vocabulary,
    outputExample: {
      scenarios: [{
        id: 'scenario_1',
        name: 'Business behavior',
        objective: 'What this scenario proves',
        actor: 'authenticated user',
        initialState: ['required business state'],
        actions: [{
          id: 'action_1',
          verb: 'create',
          resource: 'known resource from semanticVocabulary',
          capability: vocabulary.capabilities[0],
          values: {
            parentId: { semanticType: 'known.id.type', fromActionId: 'earlier_action_id' },
          },
          expectedOutcomes: [],
        }],
        invariants: ['business invariant'],
        evidenceRequired: ['observable business result'],
        cleanup: 'automatic',
      }],
      warnings: [],
    },
  });
}

function intentRepairUserPrompt(
  context: PlannerContext,
  evidence: EvidenceGraph,
  invalidContent: string,
  validationError: string,
  attempt: number,
  maxAttempts: number,
): string {
  return JSON.stringify({
    task: 'Repair the invalid protocol-neutral business intent.',
    attempt,
    maxAttempts,
    validationError,
    invalidResponse: invalidContent.slice(0, 200_000),
    originalRequest: JSON.parse(intentUserPrompt(context, evidence)) as unknown,
  });
}

function parseIntent(content: string, context: PlannerContext): IntentPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(structuredIntentJson(content));
  } catch (error) {
    throw new Error(`AI intent output is not strict JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.scenarios) || !Array.isArray(parsed.warnings)) {
    throw new Error('AI intent output must contain scenarios and warnings arrays.');
  }
  const scenarios = parsed.scenarios.map((scenario, index) => parseScenario(scenario, index));
  const warnings = normalizeWarnings(parsed.warnings);
  validateScenarioCount(scenarios.length, context);
  return {
    schemaVersion: 'brisk-aitesting.intent.v1',
    goal: context.input.goal,
    scenarios,
    warnings,
  };
}

function normalizeWarnings(value: readonly unknown[]): readonly string[] {
  return value.flatMap((warning, index) => {
    if (typeof warning !== 'string') throw new Error(`warnings.${index} must be a string.`);
    const normalized = warning.trim();
    return normalized.length === 0 ? [] : [normalized];
  });
}

function structuredIntentJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  if (!trimmed.startsWith('<think>')) return trimmed;

  const closing = trimmed.indexOf('</think>');
  if (closing < 0 || trimmed.indexOf('</think>', closing + 8) >= 0) {
    throw new Error('reasoning envelope must contain exactly one closed <think> block');
  }
  const remainder = trimmed.slice(closing + 8).trim();
  const fenced = remainder.match(/^```json\s*([\s\S]*?)\s*```$/i);
  const json = (fenced?.[1] ?? remainder).trim();
  if (!json.startsWith('{') || !json.endsWith('}')) {
    throw new Error('reasoning envelope must be followed by exactly one JSON object, optionally in one JSON fence');
  }
  return json;
}

function parseScenario(value: unknown, index: number): IntentPlan['scenarios'][number] {
  if (!isRecord(value)) throw new Error(`scenarios.${index} must be an object.`);
  if (!Array.isArray(value.actions) || value.actions.length === 0) throw new Error(`scenarios.${index}.actions must be a non-empty array.`);
  if (!Array.isArray(value.invariants)) throw new Error(`scenarios.${index}.invariants must be an array.`);
  if (!Array.isArray(value.evidenceRequired)) throw new Error(`scenarios.${index}.evidenceRequired must be an array.`);
  if (!['automatic', 'isolated', 'manual'].includes(String(value.cleanup))) throw new Error(`scenarios.${index}.cleanup is invalid.`);
  return {
    id: requireString(value.id, `scenarios.${index}.id`),
    name: requireString(value.name, `scenarios.${index}.name`),
    objective: requireString(value.objective, `scenarios.${index}.objective`),
    ...(value.actor === undefined ? {} : { actor: requireString(value.actor, `scenarios.${index}.actor`) }),
    ...(value.initialState === undefined
      ? {}
      : {
          initialState: requireStringArray(value.initialState, `scenarios.${index}.initialState`),
        }),
    actions: value.actions.map((action, actionIndex) => parseAction(action, index, actionIndex)),
    invariants: requireStringArray(value.invariants, `scenarios.${index}.invariants`),
    evidenceRequired: requireStringArray(value.evidenceRequired, `scenarios.${index}.evidenceRequired`),
    cleanup: value.cleanup as 'automatic' | 'isolated' | 'manual',
  };
}

function parseAction(value: unknown, scenarioIndex: number, actionIndex: number): IntentPlan['scenarios'][number]['actions'][number] {
  const path = `scenarios.${scenarioIndex}.actions.${actionIndex}`;
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  if (!Array.isArray(value.expectedOutcomes)) throw new Error(`${path}.expectedOutcomes must be an array.`);
  const capability = value.capability;
  if (capability !== undefined && !CAPABILITIES.includes(capability as typeof CAPABILITIES[number])) {
    throw new Error(`${path}.capability is invalid.`);
  }
  return {
    id: requireString(value.id, `${path}.id`),
    verb: requireString(value.verb, `${path}.verb`),
    resource: requireString(value.resource, `${path}.resource`),
    ...(capability === undefined ? {} : { capability: capability as typeof CAPABILITIES[number] }),
    ...(value.actor === undefined ? {} : { actor: requireString(value.actor, `${path}.actor`) }),
    ...(value.phase === undefined
      ? {}
      : ['setup', 'test', 'verification'].includes(String(value.phase))
        ? { phase: value.phase as 'setup' | 'test' | 'verification' }
        : (() => { throw new Error(`${path}.phase is invalid.`); })()),
    ...(value.values === undefined ? {} : { values: parseIntentValues(value.values, `${path}.values`) }),
    expectedOutcomes: requireStringArray(value.expectedOutcomes, `${path}.expectedOutcomes`),
  };
}

function parseIntentValues(value: unknown, path: string): NonNullable<IntentPlan['scenarios'][number]['actions'][number]['values']> {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const result: Record<string, { semanticType: string; value?: unknown; fixture?: string; secretRef?: string; fromActionId?: string }> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.trim().length === 0 || !isRecord(raw)) throw new Error(`${path}.${key || '(blank)'} must be an object.`);
    const selectors = ['value', 'fixture', 'secretRef', 'fromActionId'].filter((field) => Object.prototype.hasOwnProperty.call(raw, field));
    if (selectors.length !== 1) throw new Error(`${path}.${key} must contain exactly one of value, fixture, secretRef, or fromActionId.`);
    result[key] = {
      semanticType: requireString(raw.semanticType, `${path}.${key}.semanticType`),
      ...(Object.prototype.hasOwnProperty.call(raw, 'value') ? { value: raw.value } : {}),
      ...(raw.fixture === undefined ? {} : { fixture: requireString(raw.fixture, `${path}.${key}.fixture`) }),
      ...(raw.secretRef === undefined ? {} : { secretRef: requireString(raw.secretRef, `${path}.${key}.secretRef`) }),
      ...(raw.fromActionId === undefined ? {} : { fromActionId: requireString(raw.fromActionId, `${path}.${key}.fromActionId`) }),
    };
  }
  return result;
}

function validateScenarioCount(count: number, context: PlannerContext): void {
  const requested = context.input.scenarios;
  const policy = context.input.scenarioCountPolicy ?? 'flexible';
  if (requested === undefined || policy === 'flexible') return;
  if (policy === 'exact' && count !== requested) throw new Error(`AI intent returned ${count} scenarios; exactly ${requested} were required.`);
  if (policy === 'at-least' && count < requested) throw new Error(`AI intent returned ${count} scenarios; at least ${requested} were required.`);
  if (policy === 'at-most' && count > requested) throw new Error(`AI intent returned ${count} scenarios; at most ${requested} were required.`);
}

function normalizeRepairAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(5, Math.trunc(value)));
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path} must be a non-empty string.`);
  return value.trim();
}

function requireStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((entry, index) => requireString(entry, `${path}.${index}`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
