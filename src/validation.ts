import type { PlanValidator, PlanValidatorContext, ValidationIssue, ValidationResult } from './types.js';
import { validatePlanJsonContract } from './plan-contract.js';

const ENGINE_TYPES = new Set(['ui', 'api', 'contract', 'schema', 'replay', 'custom']);
const PLAN_KEYS = new Set(['schemaVersion', 'runId', 'goal', 'mode', 'scenarios', 'discovery', 'warnings', 'createdAt']);
const SCENARIO_KEYS = new Set(['id', 'name', 'type', 'objective', 'target', 'request', 'expect', 'assertions', 'uiActions', 'evidenceRequired', 'metadata']);
const TARGET_KEYS = new Set(['method', 'path', 'route', 'schema']);
const REQUEST_KEYS = new Set(['headers', 'query', 'body']);
const EXPECT_KEYS = new Set(['status', 'json', 'contains']);
const UI_ACTION_KEYS = new Set(['action', 'evidenceId', 'value', 'key', 'text', 'description']);
const EVIDENCE_TYPES = new Set(['repo', 'ui', 'api', 'schema', 'auth']);

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
      if (scenario.objective.trim().length === 0) issues.push(error(`${path}.objective`, 'REQUIRED', 'Scenario objective is required.'));
      if (!ENGINE_TYPES.has(scenario.type)) issues.push(error(`${path}.type`, 'INVALID_ENGINE_TYPE', `Unsupported scenario type "${scenario.type}".`));
      if (scenario.assertions.length === 0) issues.push(warning(`${path}.assertions`, 'MISSING_ASSERTIONS', 'Scenario has no human-readable assertions.'));
      if (!Array.isArray(scenario.assertions) || !scenario.assertions.every((assertion) => typeof assertion === 'string' && assertion.trim().length > 0)) {
        issues.push(error(`${path}.assertions`, 'INVALID_ASSERTIONS', 'Scenario assertions must be non-empty strings.'));
      }
      validateEvidenceRequired(path, scenario, issues);

      validateEngineTarget(path, scenario, issues);
      validateRequest(path, scenario, issues);
      validateExpectations(path, scenario, issues);
      validateUiActions(path, scenario, issues);
    });

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

function validateEngineTarget(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], issues: ValidationIssue[]): void {
  if (scenario.target !== undefined) validateObjectKeys(`${path}.target`, scenario.target, TARGET_KEYS, issues);
  if (scenario.type === 'ui') {
    if (scenario.target?.route === undefined || !scenario.target.route.startsWith('/')) {
      issues.push(error(`${path}.target.route`, 'REQUIRED_UI_ROUTE', 'UI scenario target.route must start with /.'));
    }
  }
  if (scenario.type === 'api') {
    const method = scenario.target?.method;
    const apiPath = scenario.target?.path;
    if (method === undefined || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      issues.push(error(`${path}.target.method`, 'REQUIRED_API_METHOD', 'API scenario target.method must be GET, POST, PUT, PATCH, or DELETE.'));
    }
    if (apiPath === undefined || !apiPath.startsWith('/')) {
      issues.push(error(`${path}.target.path`, 'REQUIRED_API_PATH', 'API scenario target.path must start with /.'));
    }
  }
  if ((scenario.type === 'contract' || scenario.type === 'schema') && scenario.target?.schema === undefined && scenario.evidenceRequired.includes('schema')) {
    issues.push(warning(`${path}.target.schema`, 'MISSING_SCHEMA_TARGET', 'Schema/contract scenario has no explicit target.schema.'));
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
