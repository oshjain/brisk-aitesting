import { randomUUID } from 'node:crypto';
import { BuiltinPlanner } from './planner.js';
import type {
  AiPlannerProvider,
  DiscoveryResult,
  EngineType,
  Planner,
  PlannerContext,
  PlannerRepairContext,
  ScenarioPlan,
  TestPlan,
  UiActionEnrichmentContext,
  UiActionPlan,
} from './types.js';

type ExpectedStatus = NonNullable<ScenarioPlan['expect']>['status'];

export class AiPlanner implements Planner {
  readonly name = 'ai-planner';
  private readonly fallback = new BuiltinPlanner();

  constructor(private readonly provider: AiPlannerProvider) {}

  async plan(context: PlannerContext): Promise<TestPlan> {
    const response = await this.provider.complete({
      jsonSchemaName: 'brisk-aitesting.plan.v1',
      system: buildSystemPrompt(),
      user: buildUserPrompt(context),
    });
    const parsed = parseAiPlan(response.content);
    return this.buildPlan(parsed, context);
  }

  async repair(context: PlannerRepairContext): Promise<TestPlan> {
    const response = await this.provider.complete({
      jsonSchemaName: 'brisk-aitesting.plan.v1',
      system: buildRepairSystemPrompt(),
      user: buildRepairUserPrompt(context),
    });
    const parsed = parseAiPlan(response.content);
    return this.buildPlan(parsed, context);
  }

  async enrichUiActions(context: UiActionEnrichmentContext): Promise<readonly UiActionPlan[]> {
    const response = await this.provider.complete({
      jsonSchemaName: 'brisk-aitesting.plan.v1',
      system: buildUiActionEnrichmentSystemPrompt(),
      user: buildUiActionEnrichmentUserPrompt(context),
    });
    return parseAiUiActions(response.content);
  }

  private async buildPlan(parsed: ReturnType<typeof parseAiPlan>, context: PlannerContext): Promise<TestPlan> {
    const plan = buildNormalizedPlan(parsed, context);
    if (plan !== undefined) return plan;
    return this.fallback.plan(context);
  }
}

function buildSystemPrompt(): string {
  return [
    'You are the planner for brisk-aitesting.',
    'Return only JSON. Do not return markdown or TypeScript.',
    'Plan high-level test scenarios. Do not generate executable test code.',
    'For UI interactions, output uiActions with action intent and evidenceId only. Do not output CSS selectors or Playwright code.',
    'Each scenario must choose one type: ui, api, contract, schema, replay, or custom.',
    'UI scenarios need target.route. API scenarios need target.method and target.path.',
    'Prefer discovered routes and APIs. Do not invent targets when discovery provides options.',
  ].join('\n');
}

function buildRepairSystemPrompt(): string {
  return [
    'You are the repair planner for brisk-aitesting.',
    'Return only JSON. Do not return markdown, TypeScript, prose, or comments.',
    'Repair the supplied test plan so it satisfies every validation issue.',
    'Keep valid scenarios when possible. Change only fields needed to make the plan executable.',
    'Each scenario must choose one type: ui, api, contract, schema, replay, or custom.',
    'UI scenarios need target.route beginning with /. API scenarios need target.method and target.path beginning with /.',
    'UI actions must use evidenceId values like ui_el_001. Do not invent selectors.',
    'Prefer discovered routes and APIs. Do not invent targets when discovery provides options.',
  ].join('\n');
}

function buildUiActionEnrichmentSystemPrompt(): string {
  return [
    'You are the UI action enrichment planner for brisk-aitesting.',
    'Return only JSON. Do not return markdown, TypeScript, Playwright code, CSS selectors, XPath, or prose.',
    'Choose UI actions only from the provided grounding evidence IDs.',
    'Every action must include evidenceId exactly as provided, for example ui_el_003.',
    'Supported actions: fill, click, check, select, press, assertText.',
    'Do not create actions when the evidence does not support the requested workflow.',
  ].join('\n');
}

function buildUserPrompt(context: PlannerContext): string {
  return JSON.stringify({
    goal: context.input.goal,
    scenarios: context.input.scenarios ?? 5,
    mode: context.input.mode ?? 'automatic',
    requiredTypes: context.input.requiredTypes ?? [],
    app: context.config.app,
    discovery: summarizeDiscovery(context.discovery),
    outputShape: {
      mode: 'automatic',
      warnings: [],
      scenarios: [
        {
          name: 'Scenario name',
          type: 'ui',
          objective: 'What this proves',
          target: { route: '/' },
          request: {},
          expect: {},
          assertions: ['human readable assertion'],
          uiActions: [
            { action: 'fill', evidenceId: 'ui_el_001', value: 'user@example.com' },
            { action: 'click', evidenceId: 'ui_el_003' },
          ],
          evidenceRequired: ['ui'],
        },
      ],
    },
  }, null, 2);
}

function buildRepairUserPrompt(context: PlannerRepairContext): string {
  return JSON.stringify({
    goal: context.input.goal,
    attempt: context.attempt,
    maxAttempts: context.maxAttempts,
    mode: context.input.mode ?? 'automatic',
    requiredTypes: context.input.requiredTypes ?? [],
    app: context.config.app,
    discovery: summarizeDiscovery(context.discovery),
    validationIssues: context.validation.issues.map((issue) => ({
      severity: issue.severity,
      path: issue.path,
      code: issue.code,
      message: issue.message,
    })),
    invalidPlan: sanitizePlanForRepair(context.invalidPlan),
    outputShape: {
      mode: context.input.mode ?? 'automatic',
      warnings: ['fixed validation issues'],
      scenarios: [
        {
          name: 'Scenario name',
          type: 'api',
          objective: 'What this proves',
          target: { method: 'GET', path: '/api/health' },
          request: {},
          expect: { status: 200 },
          assertions: ['human readable assertion'],
          uiActions: [],
          evidenceRequired: ['api'],
        },
      ],
    },
  }, null, 2);
}

function buildUiActionEnrichmentUserPrompt(context: UiActionEnrichmentContext): string {
  return JSON.stringify({
    goal: context.input.goal,
    scenario: {
      id: context.scenario.id,
      name: context.scenario.name,
      objective: context.scenario.objective,
      target: context.scenario.target,
      existingUiActions: context.scenario.uiActions ?? [],
    },
    grounding: {
      route: context.grounding.route,
      url: context.grounding.url,
      title: context.grounding.title,
      summary: context.grounding.summary,
      elements: context.grounding.elements.slice(0, 100).map((element) => ({
        id: element.id,
        kind: element.kind,
        role: element.role,
        label: element.label,
        text: element.text,
        testId: element.testId,
        tagName: element.tagName,
        inputType: element.inputType,
        locator: element.locator,
        confidence: element.confidence,
      })),
    },
    outputShape: {
      uiActions: [
        { action: 'fill', evidenceId: 'ui_el_001', value: 'value to type' },
        { action: 'click', evidenceId: 'ui_el_003' },
      ],
    },
  }, null, 2);
}

function sanitizePlanForRepair(plan: TestPlan): unknown {
  return {
    mode: plan.mode,
    warnings: plan.warnings,
    scenarios: plan.scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      type: scenario.type,
      objective: scenario.objective,
      target: scenario.target,
      request: scenario.request,
      expect: scenario.expect,
      assertions: scenario.assertions,
      uiActions: scenario.uiActions,
      evidenceRequired: scenario.evidenceRequired,
      metadata: scenario.metadata,
    })),
  };
}

function ensureRequiredTypes(scenarios: readonly ScenarioPlan[], context: PlannerContext): readonly ScenarioPlan[] {
  const required = context.input.requiredTypes ?? [];
  if (required.length === 0) return scenarios;
  const desired = context.input.scenarios ?? Math.max(scenarios.length, required.length);
  const result = [...scenarios];
  for (const type of required) {
    if (result.some((scenario) => scenario.type === type)) continue;
    const replacement = scenarioForType(type, context);
    const replaceIndex = result.findIndex((scenario, index) => !required.includes(scenario.type) || result.findIndex((other) => other.type === scenario.type) !== index);
    if (replaceIndex >= 0 && result.length >= desired) {
      result[replaceIndex] = replacement;
    } else {
      result.push(replacement);
    }
  }
  return result.slice(0, Math.max(desired, required.length));
}

function scenarioForType(type: EngineType, context: PlannerContext): ScenarioPlan {
  if (type === 'api') {
    const apiRoute = context.discovery.apiRoutes.find((route) => route.path === '/api/health') ?? context.discovery.apiRoutes[0];
    return {
      id: `required_api_${randomUUID()}`,
      name: 'Required API coverage',
      type: 'api',
      objective: 'Ensure required API coverage is present in the plan.',
      target: { method: apiRoute?.method ?? 'GET', path: apiRoute?.path ?? '/api/health' },
      expect: { status: { min: 200, max: 499 } },
      assertions: ['API responds with a controlled status'],
      evidenceRequired: ['api'],
    };
  }
  if (type === 'ui') {
    return {
      id: `required_ui_${randomUUID()}`,
      name: 'Required UI coverage',
      type: 'ui',
      objective: 'Ensure required UI coverage is present in the plan.',
      target: { route: context.discovery.uiRoutes[0]?.path ?? '/' },
      assertions: ['page body is visible'],
      evidenceRequired: ['ui'],
    };
  }
  return {
    id: `required_${type}_${randomUUID()}`,
    name: `Required ${type} coverage`,
    type,
    objective: `Ensure required ${type} coverage is present in the plan.`,
    assertions: [`${type} coverage exists`],
    evidenceRequired: type === 'schema' || type === 'contract' ? ['schema'] : ['repo'],
  };
}

function summarizeDiscovery(discovery: DiscoveryResult): unknown {
  return {
    uiRoutes: discovery.uiRoutes.slice(0, 30),
    apiRoutes: discovery.apiRoutes.slice(0, 50),
    contracts: discovery.contracts,
    ...(discovery.contractDrift !== undefined
      ? {
          contractDrift: {
            implementedButUndocumented: discovery.contractDrift.implementedButUndocumented.slice(0, 20),
            documentedButNotImplemented: discovery.contractDrift.documentedButNotImplemented.slice(0, 20),
            diagnostics: discovery.contractDrift.diagnostics,
          },
        }
      : {}),
    repoSignals: discovery.repoSignals.slice(0, 50),
  };
}

function parseAiPlan(content: string): {
  readonly mode?: 'automatic' | EngineType;
  readonly warnings?: unknown;
  readonly scenarios?: unknown;
} {
  const json = extractJsonObject(content, isPlanLikeObject);
  const parsed = unwrapPlanObject(JSON.parse(repairJson(json)) as unknown);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI planner returned JSON that is not an object.');
  }
  return parsed as {
    readonly mode?: 'automatic' | EngineType;
    readonly warnings?: unknown;
    readonly scenarios?: unknown;
  };
}

function parseAiUiActions(content: string): readonly UiActionPlan[] {
  const json = extractJsonObject(content);
  const parsed = JSON.parse(repairJson(json)) as unknown;
  const source = isRecord(parsed) ? parsed.uiActions ?? parsed.actions ?? parsed.steps : undefined;
  return normalizeUiActions(source) ?? [];
}

function unwrapPlanObject(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isRecord(value.testPlan)) return value.testPlan;
  if (isRecord(value.plan)) return value.plan;
  return value;
}

export function parseAiPlanForTesting(content: string, context: PlannerContext): TestPlan {
  const parsed = parseAiPlan(content);
  const plan = buildNormalizedPlan(parsed, context);
  if (plan === undefined) throw new Error('AI planner returned no scenarios after normalization.');
  return plan;
}

function buildNormalizedPlan(parsed: ReturnType<typeof parseAiPlan>, context: PlannerContext): TestPlan | undefined {
  const scenarios = ensureRequiredTypes(normalizeAiScenarios(normalizeScenarioCollection(parsed), context), context);
  if (scenarios.length === 0) return undefined;
  return {
    schemaVersion: 'brisk-aitesting.plan.v1',
    runId: context.runId,
    goal: context.input.goal,
    mode: context.input.mode ?? parsed.mode ?? 'automatic',
    scenarios,
    discovery: context.discovery,
    warnings: normalizeStringArray(parsed.warnings),
    createdAt: new Date().toISOString(),
  };
}

function normalizeScenarioCollection(parsed: ReturnType<typeof parseAiPlan>): unknown {
  if (Array.isArray(parsed.scenarios)) return parsed.scenarios;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.tests)) return record.tests;
  if (Array.isArray(record.testCases)) return record.testCases;
  return parsed.scenarios;
}

function repairJson(value: string): string {
  return value
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g, '$1"$2"$3');
}

function extractJsonObject(content: string, accepts: (value: unknown) => boolean = () => true): string {
  const trimmed = content.trim();
  const candidates = jsonCandidates(trimmed);
  for (const candidate of candidates.sort((left, right) => right.length - left.length)) {
    try {
      const parsed = JSON.parse(repairJson(candidate)) as unknown;
      if (accepts(parsed)) return candidate;
    } catch {
      // Try the next balanced JSON-looking candidate.
    }
  }
  if (candidates.length > 0) return candidates[0]!;
  throw new Error('AI planner did not return a JSON object.');
}

function isPlanLikeObject(value: unknown): boolean {
  const unwrapped = unwrapPlanObject(value);
  return isRecord(unwrapped)
    && (Array.isArray(unwrapped.scenarios) || Array.isArray(unwrapped.tests) || Array.isArray(unwrapped.testCases));
}

function jsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  for (const match of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fenced = match[1]?.trim();
    if (fenced?.startsWith('{') === true) candidates.push(fenced);
  }
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '{') continue;
    const end = findBalancedJsonEnd(content, index);
    if (end > index) candidates.push(content.slice(index, end + 1));
  }
  if (content.startsWith('{') && content.endsWith('}')) candidates.push(content);
  return [...new Set(candidates)];
}

function findBalancedJsonEnd(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeAiScenarios(value: unknown, context: PlannerContext): readonly ScenarioPlan[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => normalizeScenario(entry, index, context));
}

function normalizeScenario(value: unknown, index: number, context: PlannerContext): ScenarioPlan {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const type = normalizeEngineType(record.type ?? record.category ?? record.testType);
  const target = normalizeTarget(record.target, type, context.discovery);
  const request = normalizeRequest(record.request);
  const expect = normalizeExpect(record.expect ?? record.expected);
  const uiActions = type === 'ui' ? normalizeUiActions(record.uiActions ?? record.actions ?? record.steps) : undefined;
  const metadata = isRecord(record.metadata) ? record.metadata : undefined;
  return {
    id: normalizeIdentifier(record.id, `ai_scenario_${index + 1}`),
    name: normalizeString(record.name, `AI scenario ${index + 1}`),
    type,
    objective: normalizeString(record.objective, `Validate ${type} behavior for ${context.input.goal}`),
    ...(target !== undefined ? { target } : {}),
    ...(request !== undefined ? { request } : {}),
    ...(expect !== undefined ? { expect } : {}),
    assertions: normalizeStringArray(record.assertions, ['scenario completes successfully']),
    ...(uiActions !== undefined ? { uiActions } : {}),
    evidenceRequired: normalizeEvidenceRequired(record.evidenceRequired, type),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function normalizeIdentifier(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(value)) return value;
  return `${fallback}_${randomUUID()}`;
}

function normalizeEngineType(value: unknown): EngineType {
  if (typeof value !== 'string') return 'custom';
  const normalized = value.trim().toLowerCase();
  if (['ui', 'api', 'contract', 'schema', 'replay', 'custom'].includes(normalized)) return normalized as EngineType;
  if (['e2e', 'browser', 'frontend'].includes(normalized)) return 'ui';
  if (['integration', 'workflow', 'end-to-end'].includes(normalized)) return 'ui';
  if (['backend', 'http', 'rest'].includes(normalized)) return 'api';
  if (['openapi', 'asyncapi'].includes(normalized)) return 'schema';
  return 'custom';
}

function normalizeTarget(value: unknown, type: EngineType, discovery: DiscoveryResult): ScenarioPlan['target'] {
  const record = isRecord(value) ? value : {};
  if (type === 'ui') {
    const route = normalizePath(record.route ?? record.path ?? record.url) ?? discovery.uiRoutes[0]?.path ?? '/';
    return { route };
  }
  if (type === 'api') {
    const discovered = discovery.apiRoutes[0];
    const method = normalizeMethod(record.method) ?? discovered?.method ?? 'GET';
    const path = normalizePath(record.path ?? record.route ?? record.url) ?? discovered?.path ?? '/';
    return { method, path };
  }
  if (type === 'contract' || type === 'schema') {
    const schema = typeof record.schema === 'string' ? record.schema : discovery.contracts.find((contract) => contract.exists)?.path;
    return schema !== undefined ? { schema } : {};
  }
  return isRecord(value) ? value as ScenarioPlan['target'] : {};
}

function normalizeUiActions(value: unknown): readonly UiActionPlan[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions = value
    .map(normalizeUiAction)
    .filter((action): action is UiActionPlan => action !== undefined);
  return actions.length > 0 ? actions : undefined;
}

function normalizeUiAction(value: unknown): UiActionPlan | undefined {
  if (!isRecord(value)) return undefined;
  const rawAction = typeof value.action === 'string' ? value.action : typeof value.type === 'string' ? value.type : undefined;
  const action = normalizeUiActionName(rawAction);
  const evidenceId = typeof value.evidenceId === 'string' ? value.evidenceId.trim() : typeof value.elementId === 'string' ? value.elementId.trim() : undefined;
  const description = typeof value.description === 'string' && value.description.trim().length > 0 ? value.description.trim() : undefined;
  if (action === undefined || evidenceId === undefined || !/^ui_el_\d{3,}$/.test(evidenceId)) return undefined;
  if (action === 'click' || action === 'check') return { action, evidenceId, ...(description !== undefined ? { description } : {}) };
  if (action === 'fill') {
    const fillValue = typeof value.value === 'string' ? value.value : typeof value.text === 'string' ? value.text : undefined;
    return fillValue !== undefined ? { action, evidenceId, value: fillValue, ...(description !== undefined ? { description } : {}) } : undefined;
  }
  if (action === 'select') {
    const selectValue = typeof value.value === 'string' ? value.value : undefined;
    return selectValue !== undefined ? { action, evidenceId, value: selectValue, ...(description !== undefined ? { description } : {}) } : undefined;
  }
  if (action === 'press') {
    const key = typeof value.key === 'string' ? value.key : undefined;
    return key !== undefined ? { action, evidenceId, key, ...(description !== undefined ? { description } : {}) } : undefined;
  }
  if (action === 'assertText') {
    const text = typeof value.text === 'string' ? value.text : typeof value.value === 'string' ? value.value : undefined;
    return text !== undefined ? { action, evidenceId, text, ...(description !== undefined ? { description } : {}) } : undefined;
  }
  return undefined;
}

function normalizeUiActionName(value: unknown): UiActionPlan['action'] | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'fill' || normalized === 'type' || normalized === 'input') return 'fill';
  if (normalized === 'click' || normalized === 'tap') return 'click';
  if (normalized === 'select' || normalized === 'choose') return 'select';
  if (normalized === 'check') return 'check';
  if (normalized === 'press' || normalized === 'keypress') return 'press';
  if (normalized === 'asserttext' || normalized === 'assert-text' || normalized === 'expecttext') return 'assertText';
  return undefined;
}

function normalizeRequest(value: unknown): ScenarioPlan['request'] | undefined {
  if (!isRecord(value)) return undefined;
  const headers = isStringRecord(value.headers) ? value.headers : undefined;
  const query = isQueryRecord(value.query) ? value.query : undefined;
  return {
    ...(headers !== undefined ? { headers } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(value.body !== undefined ? { body: value.body } : {}),
  };
}

function normalizeExpect(value: unknown): ScenarioPlan['expect'] | undefined {
  if (!isRecord(value)) return undefined;
  const status = normalizeStatus(value.status ?? value.statusCode);
  const json = isRecord(value.json) ? value.json : undefined;
  const contains = typeof value.contains === 'string' ? value.contains : undefined;
  return {
    ...(status !== undefined ? { status } : {}),
    ...(json !== undefined ? { json } : {}),
    ...(contains !== undefined ? { contains } : {}),
  };
}

function normalizeStatus(value: unknown): ExpectedStatus | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) return Number(value.trim());
  if (Array.isArray(value)) {
    const statuses = value
      .map((entry) => typeof entry === 'number' ? entry : typeof entry === 'string' && /^\d{3}$/.test(entry.trim()) ? Number(entry.trim()) : undefined)
      .filter((entry): entry is number => entry !== undefined);
    return statuses.length > 0 ? statuses : undefined;
  }
  if (isRecord(value)) {
    const min = typeof value.min === 'number' ? value.min : typeof value.min === 'string' && /^\d{3}$/.test(value.min.trim()) ? Number(value.min.trim()) : undefined;
    const max = typeof value.max === 'number' ? value.max : typeof value.max === 'string' && /^\d{3}$/.test(value.max.trim()) ? Number(value.max.trim()) : undefined;
    return min !== undefined || max !== undefined ? { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } : undefined;
  }
  return undefined;
}

function normalizeMethod(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, string> = {
    READ: 'GET',
    CREATE: 'POST',
    UPDATE: 'PUT',
    MODIFY: 'PATCH',
    REMOVE: 'DELETE',
  };
  return aliases[normalized] ?? normalized;
}

function normalizePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const url = new URL(trimmed);
    return normalizePath(url.pathname);
  } catch {
    const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/i, '');
    const noQuery = withoutOrigin.split(/[?#]/, 1)[0] ?? '';
    const normalized = `/${noQuery.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : '/';
  }
}

function normalizeEvidenceRequired(value: unknown, type: EngineType): ScenarioPlan['evidenceRequired'] {
  const allowed = new Set(['repo', 'ui', 'api', 'schema', 'auth']);
  if (Array.isArray(value)) {
    const normalized = value.filter((entry): entry is ScenarioPlan['evidenceRequired'][number] => typeof entry === 'string' && allowed.has(entry));
    if (normalized.length > 0) return normalized;
  }
  if (type === 'ui') return ['ui'];
  if (type === 'api') return ['api'];
  if (type === 'contract' || type === 'schema') return ['schema'];
  return ['repo'];
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, fallback: readonly string[] = []): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim());
  return normalized.length > 0 ? normalized : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isQueryRecord(value: unknown): value is Record<string, string | number | boolean> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean');
}
