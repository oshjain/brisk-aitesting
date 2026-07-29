import type { PlanValidator, PlanValidatorContext, ValidationIssue, ValidationResult } from './types.js';
import { validatePlanJsonContract } from './plan-contract.js';

const ENGINE_TYPES = new Set(['ui', 'api', 'contract', 'schema', 'replay', 'message', 'custom']);
const PLAN_KEYS = new Set(['schemaVersion', 'runId', 'goal', 'mode', 'scenarios', 'discovery', 'warnings', 'createdAt']);
const SCENARIO_KEYS = new Set(['id', 'name', 'type', 'objective', 'target', 'request', 'expect', 'assertions', 'dependsOn', 'capture', 'cleanup', 'uiActions', 'evidenceRequired', 'metadata']);
const TARGET_KEYS = new Set(['method', 'path', 'route', 'schema', 'channel', 'sourceOfTruth']);
const REQUEST_KEYS = new Set(['headers', 'query', 'body']);
const EXPECT_KEYS = new Set(['status', 'json', 'contains', 'unchanged']);
const UI_ACTION_KEYS = new Set(['action', 'evidenceId', 'value', 'key', 'text', 'description']);
const CAPTURE_KEYS = new Set(['name', 'from', 'path']);
const CLEANUP_KEYS = new Set(['type', 'target', 'request', 'expect']);
const EVIDENCE_TYPES = new Set(['repo', 'ui', 'api', 'schema', 'auth', 'message']);
const TARGET_PROVENANCE = new Set(['user', 'observed', 'contract', 'ai', 'fallback']);
const BUILTIN_WORKFLOW_VARIABLES = new Set(['unique', 'uuid', 'timestamp', 'now']);

export class BuiltinPlanValidator implements PlanValidator {
  readonly name = 'builtin-plan-validator';

  validate(context: PlanValidatorContext): ValidationResult {
    const contractIssues = validatePlanJsonContract(context.plan);
    if (contractIssues.some((issue) => issue.severity === 'error')) {
      return {
        schemaVersion: 'brisk-aitesting.validation.v1',
        valid: false,
        issues: contractIssues,
      };
    }

    const issues: ValidationIssue[] = [...contractIssues];
    const plan = context.plan;

    validateObjectKeys('plan', plan, PLAN_KEYS, issues);
    if (plan.schemaVersion !== 'brisk-aitesting.plan.v1') {
      issues.push(error('plan.schemaVersion', 'INVALID_SCHEMA', 'Plan schemaVersion must be brisk-aitesting.plan.v1.'));
    }
    if (plan.runId.trim().length === 0) {
      issues.push(error('plan.runId', 'REQUIRED', 'Plan runId is required.'));
    }
    if (plan.goal.trim().length === 0) {
      issues.push(error('plan.goal', 'REQUIRED', 'Plan goal is required.'));
    }
    if (plan.discovery.schemaVersion !== 'brisk-aitesting.discovery.v1') {
      issues.push(error('plan.discovery.schemaVersion', 'INVALID_DISCOVERY', 'Plan discovery must use brisk-aitesting.discovery.v1.'));
    }
    if (plan.scenarios.length === 0) {
      issues.push(error('plan.scenarios', 'REQUIRED', 'Plan must contain at least one scenario.'));
    }
    if (plan.mode !== 'automatic' && !ENGINE_TYPES.has(plan.mode)) {
      issues.push(error('plan.mode', 'INVALID_MODE', `Unsupported plan mode "${plan.mode}".`));
    }
    if (!Array.isArray(plan.warnings) || !plan.warnings.every((entry) => typeof entry === 'string')) {
      issues.push(error('plan.warnings', 'INVALID_WARNINGS', 'Plan warnings must be an array of strings.'));
    }
    if (Number.isNaN(Date.parse(plan.createdAt))) {
      issues.push(error('plan.createdAt', 'INVALID_DATE', 'Plan createdAt must be an ISO-compatible date string.'));
    }
    for (const requiredType of context.input.requiredTypes ?? []) {
      if (!plan.scenarios.some((scenario) => scenario.type === requiredType)) {
        issues.push(error('plan.scenarios', 'MISSING_REQUIRED_TYPE', `Plan must include at least one ${requiredType} scenario.`));
      }
    }

    const ids = new Set<string>();
    plan.scenarios.forEach((scenario, index) => {
      const path = `plan.scenarios.${index}`;
      validateObjectKeys(path, scenario, SCENARIO_KEYS, issues);
      if (scenario.id.trim().length === 0) {
        issues.push(error(`${path}.id`, 'REQUIRED', 'Scenario id is required.'));
      } else if (ids.has(scenario.id)) {
        issues.push(error(`${path}.id`, 'DUPLICATE_ID', `Scenario id "${scenario.id}" is duplicated.`));
      } else {
        ids.add(scenario.id);
      }
      if (scenario.name.trim().length === 0) issues.push(error(`${path}.name`, 'REQUIRED', 'Scenario name is required.'));
      if (looksLikeGeneratedIdentifier(scenario.name)) {
        issues.push(error(`${path}.name`, 'LOW_VALUE_NAME', 'Scenario name must explain the behavior being tested, not only contain a generated id or prefix.'));
      }
      if (scenario.objective.trim().length === 0) issues.push(error(`${path}.objective`, 'REQUIRED', 'Scenario objective is required.'));
      if (!ENGINE_TYPES.has(scenario.type)) issues.push(error(`${path}.type`, 'INVALID_ENGINE_TYPE', `Unsupported scenario type "${scenario.type}".`));
      if (scenario.assertions.length === 0) issues.push(warning(`${path}.assertions`, 'MISSING_ASSERTIONS', 'Scenario has no human-readable assertions.'));
      if (!Array.isArray(scenario.assertions) || !scenario.assertions.every((assertion) => typeof assertion === 'string' && assertion.trim().length > 0)) {
        issues.push(error(`${path}.assertions`, 'INVALID_ASSERTIONS', 'Scenario assertions must be non-empty strings.'));
      }
      validateEvidenceRequired(path, scenario, issues);

      validateEngineTarget(path, scenario, context, issues);
      validateRequest(path, scenario, issues);
      validateExpectations(path, scenario, issues);
      validateWorkflow(path, scenario, plan.scenarios.map((candidate) => candidate.id), plan.scenarios.slice(0, index).map((candidate) => candidate.id), issues);
      validateUiActions(path, scenario, issues);
    });
    validateWorkflowReferences(plan.scenarios, issues);

    return {
      schemaVersion: 'brisk-aitesting.validation.v1',
      valid: !issues.some((issue) => issue.severity === 'error'),
      issues,
    };
  }
}

function validateUiActions(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], issues: ValidationIssue[]): void {
  if (scenario.uiActions === undefined) return;
  if (scenario.type !== 'ui') {
    issues.push(error(`${path}.uiActions`, 'UI_ACTIONS_ON_NON_UI_SCENARIO', 'uiActions are only supported on ui scenarios.'));
    return;
  }
  scenario.uiActions.forEach((action, index) => {
    const actionPath = `${path}.uiActions.${index}`;
    validateObjectKeys(actionPath, action, UI_ACTION_KEYS, issues);
    if (!/^ui_el_\d{3,}$/.test(action.evidenceId)) {
      issues.push(error(`${actionPath}.evidenceId`, 'INVALID_UI_EVIDENCE_ID', 'UI action evidenceId must look like ui_el_001.'));
    }
    if ((action.action === 'fill' || action.action === 'select') && action.value.trim().length === 0) {
      issues.push(error(`${actionPath}.value`, 'REQUIRED_UI_ACTION_VALUE', `${action.action} action requires a non-empty value.`));
    }
    if (action.action === 'press' && action.key.trim().length === 0) {
      issues.push(error(`${actionPath}.key`, 'REQUIRED_UI_ACTION_KEY', 'press action requires a non-empty key.'));
    }
    if (action.action === 'assertText' && action.text.trim().length === 0) {
      issues.push(error(`${actionPath}.text`, 'REQUIRED_UI_ASSERT_TEXT', 'assertText action requires non-empty text.'));
    }
  });
}

function validateEngineTarget(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], context: PlanValidatorContext, issues: ValidationIssue[]): void {
  if (scenario.target !== undefined) validateObjectKeys(`${path}.target`, scenario.target, TARGET_KEYS, issues);
  const target = scenario.target;
  const needsTargetProvenance = scenario.type === 'ui' || scenario.type === 'api' || scenario.type === 'contract' || scenario.type === 'schema' || scenario.type === 'message';
  if (needsTargetProvenance && target?.sourceOfTruth === undefined) {
    issues.push(error(`${path}.target.sourceOfTruth`, 'REQUIRED_TARGET_PROVENANCE', 'Executable scenario targets must say whether they are user, observed, contract, AI, or fallback derived.'));
  } else if (target?.sourceOfTruth !== undefined && !TARGET_PROVENANCE.has(target.sourceOfTruth)) {
    issues.push(error(`${path}.target.sourceOfTruth`, 'INVALID_TARGET_PROVENANCE', `Unsupported target sourceOfTruth "${target.sourceOfTruth}".`));
  } else if (target?.sourceOfTruth === 'fallback' && context.config.security.strictMode !== false && context.config.security.allowFallbackTargets !== true) {
    issues.push(error(`${path}.target.sourceOfTruth`, 'FALLBACK_TARGET_BLOCKED', 'Strict mode does not execute fallback/default targets because they were not supplied, observed, or contract-derived.'));
  } else if (target?.sourceOfTruth === 'ai' && context.config.security.strictMode !== false && context.config.security.allowAiTargets !== true) {
    issues.push(error(`${path}.target.sourceOfTruth`, 'AI_TARGET_BLOCKED', 'Strict mode does not execute AI-derived targets unless the host explicitly enables allowAiTargets.'));
  } else if (target?.sourceOfTruth === 'user' && context.config.security.strictMode !== false && !isExplicitUserTarget(scenario, context)) {
    issues.push(error(`${path}.target.sourceOfTruth`, 'USER_TARGET_NOT_SUPPLIED', 'sourceOfTruth "user" is only allowed when the host supplied this exact target outside the AI plan.'));
  }
  if (scenario.type === 'ui') {
    if (target?.route === undefined || !target.route.startsWith('/')) {
      issues.push(error(`${path}.target.route`, 'REQUIRED_UI_ROUTE', 'UI scenario target.route must start with /.'));
    } else if (target.sourceOfTruth === 'observed' && !context.plan.discovery.uiRoutes.some((route) => routePathMatches(route.path, target.route ?? ''))) {
      issues.push(error(`${path}.target.route`, 'UNPROVEN_UI_ROUTE', `UI route "${target.route}" is marked observed but was not found in UI discovery.`));
    }
  }
  if (scenario.type === 'api') {
    const method = target?.method;
    const apiPath = target?.path;
    const normalizedMethod = method?.toUpperCase();
    if (method === undefined || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      issues.push(error(`${path}.target.method`, 'REQUIRED_API_METHOD', 'API scenario target.method must be GET, POST, PUT, PATCH, or DELETE.'));
    }
    if (apiPath === undefined || !apiPath.startsWith('/')) {
      issues.push(error(`${path}.target.path`, 'REQUIRED_API_PATH', 'API scenario target.path must start with /.'));
    } else if (normalizedMethod !== undefined && (target?.sourceOfTruth === 'observed' || target?.sourceOfTruth === 'contract')) {
      const matchingRoute = context.plan.discovery.apiRoutes.some((route) => route.method.toUpperCase() === normalizedMethod && routePathMatches(route.path, apiPath) && (target.sourceOfTruth !== 'contract' || route.source === 'contract'));
      if (!matchingRoute) {
        issues.push(error(`${path}.target.path`, 'UNPROVEN_API_ROUTE', `API route "${normalizedMethod} ${apiPath}" is marked ${target.sourceOfTruth} but was not found in discovery.`));
      }
    }
    if ((normalizedMethod === 'POST' || normalizedMethod === 'PUT' || normalizedMethod === 'PATCH') && expectsSuccessfulStatus(scenario.expect?.status) && scenario.request?.body === undefined) {
      issues.push(error(`${path}.request.body`, 'REQUIRED_MUTATION_BODY', 'Successful POST/PUT/PATCH API scenarios must include a request.body so the engine does not execute an empty mutation.'));
    }
  }
  if ((scenario.type === 'contract' || scenario.type === 'schema') && scenario.target?.schema === undefined && scenario.evidenceRequired.includes('schema')) {
    issues.push(warning(`${path}.target.schema`, 'MISSING_SCHEMA_TARGET', 'Schema/contract scenario has no explicit target.schema.'));
  }
  if (scenario.type === 'message') {
    if (scenario.target?.schema === undefined) {
      issues.push(error(`${path}.target.schema`, 'REQUIRED_MESSAGE_SCHEMA', 'Message scenario target.schema must point to an AsyncAPI contract.'));
    }
    if (scenario.target?.channel === undefined || scenario.target.channel.trim().length === 0) {
      issues.push(error(`${path}.target.channel`, 'REQUIRED_MESSAGE_CHANNEL', 'Message scenario target.channel is required.'));
    }
  }
}

function isExplicitUserTarget(scenario: PlanValidatorContext['plan']['scenarios'][number], context: PlanValidatorContext): boolean {
  const explicitTargets = explicitUserTargets(context.input.metadata);
  if (explicitTargets.size === 0) return false;
  for (const key of targetKeysForScenario(scenario)) {
    if (explicitTargets.has(key)) return true;
  }
  return false;
}

function explicitUserTargets(metadata: Record<string, unknown> | undefined): ReadonlySet<string> {
  const raw = metadata?.explicitUserTargets;
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((entry): entry is string => typeof entry === 'string').map(normalizeTargetKey));
}

function targetKeysForScenario(scenario: PlanValidatorContext['plan']['scenarios'][number]): readonly string[] {
  const target = scenario.target;
  if (target === undefined) return [];
  if (scenario.type === 'api' && target.method !== undefined && target.path !== undefined) {
    return [
      normalizeTargetKey(`${target.method.toUpperCase()} ${target.path}`),
      normalizeTargetKey(`api ${target.method.toUpperCase()} ${target.path}`),
    ];
  }
  if (scenario.type === 'ui' && target.route !== undefined) {
    return [
      normalizeTargetKey(target.route),
      normalizeTargetKey(`ui ${target.route}`),
    ];
  }
  if ((scenario.type === 'contract' || scenario.type === 'schema' || scenario.type === 'message') && target.schema !== undefined) {
    return [
      normalizeTargetKey(target.schema),
      normalizeTargetKey(`${scenario.type} ${target.schema}`),
    ];
  }
  return [];
}

function normalizeTargetKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function routePathMatches(discovered: string, planned: string): boolean {
  const discoveredSegments = normalizeRoutePath(discovered).split('/').filter(Boolean);
  const plannedSegments = normalizeRoutePath(planned).split('/').filter(Boolean);
  if (discoveredSegments.length !== plannedSegments.length) return false;
  return discoveredSegments.every((segment, index) => segment === '{}' || segment === plannedSegments[index]);
}

function normalizeRoutePath(path: string): string {
  return path
    .replace(/\/+$/g, '')
    .replace(/:([A-Za-z_$][A-Za-z0-9_$-]*)/g, '{$1}')
    .replace(/\{[A-Za-z_$][A-Za-z0-9_$-]*\}/g, '{}')
    || '/';
}

function validateWorkflow(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], scenarioIds: readonly string[], earlierScenarioIds: readonly string[], issues: ValidationIssue[]): void {
  if (scenario.dependsOn !== undefined) {
    scenario.dependsOn.forEach((dependency, index) => {
      if (!scenarioIds.includes(dependency)) {
        issues.push(error(`${path}.dependsOn.${index}`, 'UNKNOWN_DEPENDENCY', `Scenario dependsOn references unknown scenario id "${dependency}".`));
      } else if (!earlierScenarioIds.includes(dependency)) {
        issues.push(error(`${path}.dependsOn.${index}`, 'DEPENDENCY_MUST_BE_EARLIER', `Scenario dependsOn references "${dependency}", but dependencies must appear earlier in the plan.`));
      }
    });
  }
  if (scenario.capture !== undefined) {
    if (scenario.type !== 'api') {
      issues.push(error(`${path}.capture`, 'CAPTURE_ON_NON_API_SCENARIO', 'Workflow capture is currently supported on api scenarios.'));
    }
    scenario.capture.forEach((capture, index) => {
      const capturePath = `${path}.capture.${index}`;
      validateObjectKeys(capturePath, capture, CAPTURE_KEYS, issues);
      if (!/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(capture.name)) {
        issues.push(error(`${capturePath}.name`, 'INVALID_CAPTURE_NAME', 'Capture name must be a safe variable name such as channelId.'));
      }
      if (capture.from !== 'response.body' && capture.from !== 'response.header') {
        issues.push(error(`${capturePath}.from`, 'INVALID_CAPTURE_SOURCE', 'Capture from must be response.body or response.header.'));
      }
      if (capture.path.trim().length === 0) {
        issues.push(error(`${capturePath}.path`, 'REQUIRED_CAPTURE_PATH', 'Capture path is required.'));
      }
    });
  }
  if (scenario.cleanup !== undefined) {
    scenario.cleanup.forEach((cleanup, index) => {
      const cleanupPath = `${path}.cleanup.${index}`;
      validateObjectKeys(cleanupPath, cleanup, CLEANUP_KEYS, issues);
      if (cleanup.type !== 'api') {
        issues.push(error(`${cleanupPath}.type`, 'INVALID_CLEANUP_TYPE', 'Cleanup type must be api.'));
      }
      validateObjectKeys(`${cleanupPath}.target`, cleanup.target, new Set(['method', 'path']), issues);
      if (cleanup.target.method !== 'DELETE' && cleanup.target.method !== 'POST') {
        issues.push(error(`${cleanupPath}.target.method`, 'INVALID_CLEANUP_METHOD', 'Cleanup method must be DELETE or POST.'));
      }
      if (!cleanup.target.path.startsWith('/')) {
        issues.push(error(`${cleanupPath}.target.path`, 'REQUIRED_API_PATH', 'Cleanup target path must start with /.'));
      }
      if (cleanup.request !== undefined) validateRequest(cleanupPath, { ...scenario, request: cleanup.request }, issues);
    });
  }
}

function validateWorkflowReferences(scenarios: readonly PlanValidatorContext['plan']['scenarios'][number][], issues: ValidationIssue[]): void {
  const available = new Set<string>(BUILTIN_WORKFLOW_VARIABLES);
  scenarios.forEach((scenario, index) => {
    const path = `plan.scenarios.${index}`;
    const executionReferences = collectWorkflowReferences({
      path: scenario.target?.path,
      request: scenario.request,
      expect: scenario.expect,
    });
    for (const reference of executionReferences) {
      if (!available.has(reference)) {
        issues.push(error(`${path}.workflow.${reference}`, 'UNBOUND_WORKFLOW_VARIABLE', `Workflow variable "${reference}" is used before an earlier scenario captures it. Add capture: [{ name: "${reference}", from: "response.body", path: "id" }] to the scenario that creates it, or use a built-in variable such as unique.`));
      }
    }
    for (const capture of scenario.capture ?? []) {
      available.add(capture.name);
    }
    const cleanupReferences = collectWorkflowReferences(scenario.cleanup);
    for (const reference of cleanupReferences) {
      if (!available.has(reference)) {
        issues.push(error(`${path}.cleanup.workflow.${reference}`, 'UNBOUND_WORKFLOW_VARIABLE', `Cleanup variable "${reference}" is used before this or an earlier scenario captures it.`));
      }
    }
  });
}

function collectWorkflowReferences(value: unknown): readonly string[] {
  const found = new Set<string>();
  collectReferences(value, found);
  return [...found];
}

function collectReferences(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/<([A-Za-z_$][A-Za-z0-9_$-]*)>/g)) found.add(match[1]!);
    for (const match of value.matchAll(/\{([A-Za-z_$][A-Za-z0-9_$-]*)\}/g)) found.add(match[1]!);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, found);
    return;
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) collectReferences(entry, found);
  }
}


function validateEvidenceRequired(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], issues: ValidationIssue[]): void {
  if (!Array.isArray(scenario.evidenceRequired) || scenario.evidenceRequired.length === 0) {
    issues.push(error(`${path}.evidenceRequired`, 'REQUIRED_EVIDENCE', 'Scenario evidenceRequired must contain at least one evidence type.'));
    return;
  }
  for (const [index, evidence] of scenario.evidenceRequired.entries()) {
    if (!EVIDENCE_TYPES.has(evidence)) {
      issues.push(error(`${path}.evidenceRequired.${index}`, 'INVALID_EVIDENCE_TYPE', `Unsupported evidence type "${evidence}".`));
    }
  }
}

function validateRequest(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], issues: ValidationIssue[]): void {
  if (scenario.request === undefined) return;
  validateObjectKeys(`${path}.request`, scenario.request, REQUEST_KEYS, issues);
  if (scenario.request.headers !== undefined && !isStringRecord(scenario.request.headers)) {
    issues.push(error(`${path}.request.headers`, 'INVALID_HEADERS', 'Request headers must be string key/value pairs.'));
  }
  if (scenario.request.query !== undefined && !isQueryRecord(scenario.request.query)) {
    issues.push(error(`${path}.request.query`, 'INVALID_QUERY', 'Request query values must be strings, numbers, or booleans.'));
  }
}

function validateExpectations(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], issues: ValidationIssue[]): void {
  if (scenario.expect !== undefined) validateObjectKeys(`${path}.expect`, scenario.expect, EXPECT_KEYS, issues);
  const expectedStatus = scenario.expect?.status;
  if (expectedStatus !== undefined) {
    const statuses = typeof expectedStatus === 'number'
      ? [expectedStatus]
      : isReadonlyNumberArray(expectedStatus)
        ? expectedStatus
        : [expectedStatus.min ?? 100, expectedStatus.max ?? 599];
    for (const status of statuses) {
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        issues.push(error(`${path}.expect.status`, 'INVALID_STATUS', 'Expected HTTP status values must be integers between 100 and 599.'));
      }
    }
  }
  if (scenario.expect?.json !== undefined && !isRecord(scenario.expect.json)) {
    issues.push(error(`${path}.expect.json`, 'INVALID_JSON_EXPECTATION', 'expect.json must be an object of expected JSON paths and values.'));
  }
  if (scenario.expect?.contains !== undefined && typeof scenario.expect.contains !== 'string') {
    issues.push(error(`${path}.expect.contains`, 'INVALID_CONTAINS_EXPECTATION', 'expect.contains must be a string.'));
  }
  if (scenario.expect?.unchanged !== undefined) {
    if (scenario.type !== 'api') {
      issues.push(error(`${path}.expect.unchanged`, 'UNCHANGED_ON_NON_API_SCENARIO', 'Unchanged state checks are supported on api scenarios.'));
    }
    scenario.expect.unchanged.forEach((snapshot, index) => {
      const snapshotPath = `${path}.expect.unchanged.${index}`;
      validateObjectKeys(snapshotPath, snapshot, new Set(['name', 'target', 'request', 'json']), issues);
      validateObjectKeys(`${snapshotPath}.target`, snapshot.target, new Set(['method', 'path']), issues);
      const method = snapshot.target.method ?? 'GET';
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
        issues.push(error(`${snapshotPath}.target.method`, 'REQUIRED_API_METHOD', 'State snapshot target.method must be GET, POST, PUT, PATCH, or DELETE.'));
      }
      if (!snapshot.target.path.startsWith('/')) {
        issues.push(error(`${snapshotPath}.target.path`, 'REQUIRED_API_PATH', 'State snapshot target.path must start with /.'));
      }
      if (snapshot.request !== undefined) {
        validateObjectKeys(`${snapshotPath}.request`, snapshot.request, REQUEST_KEYS, issues);
        if (snapshot.request.headers !== undefined && !isStringRecord(snapshot.request.headers)) {
          issues.push(error(`${snapshotPath}.request.headers`, 'INVALID_HEADERS', 'State snapshot headers must be string key/value pairs.'));
        }
        if (snapshot.request.query !== undefined && !isQueryRecord(snapshot.request.query)) {
          issues.push(error(`${snapshotPath}.request.query`, 'INVALID_QUERY', 'State snapshot query values must be strings, numbers, or booleans.'));
        }
      }
    });
  }
}

function isReadonlyNumberArray(value: NonNullable<NonNullable<PlanValidatorContext['plan']['scenarios'][number]['expect']>['status']>): value is readonly number[] {
  return Array.isArray(value);
}

function error(path: string, code: string, message: string): ValidationIssue {
  return { severity: 'error', path, code, message };
}

function warning(path: string, code: string, message: string): ValidationIssue {
  return { severity: 'warning', path, code, message };
}

function expectsSuccessfulStatus(status: PlanValidatorContext['plan']['scenarios'][number]['expect'] extends infer Expect ? Expect extends { readonly status?: infer Status } ? Status | undefined : undefined : undefined): boolean {
  if (status === undefined) return false;
  if (typeof status === 'number') return status >= 200 && status < 300;
  if (Array.isArray(status)) return status.some((entry) => entry >= 200 && entry < 300);
  if (!isRecord(status)) return false;
  const min = status.min ?? 100;
  const max = status.max ?? 599;
  return min < 300 && max >= 200;
}

function looksLikeGeneratedIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    || /^ai[-_]e2e[-_][0-9a-f-]{12,}$/i.test(trimmed)
    || /^test[-_][0-9a-f-]{12,}$/i.test(trimmed);
}

function validateObjectKeys(path: string, value: object, allowed: ReadonlySet<string>, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(error(`${path}.${key}`, 'UNRECOGNIZED_KEY', `Unrecognized key "${key}".`));
    }
  }
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
