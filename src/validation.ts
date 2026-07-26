import type { PlanValidator, PlanValidatorContext, ValidationIssue, ValidationResult } from './types.js';

const ENGINE_TYPES = new Set(['ui', 'api', 'contract', 'schema', 'replay', 'custom']);

export class BuiltinPlanValidator implements PlanValidator {
  readonly name = 'builtin-plan-validator';

  validate(context: PlanValidatorContext): ValidationResult {
    const issues: ValidationIssue[] = [];
    const plan = context.plan;

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
    for (const requiredType of context.input.requiredTypes ?? []) {
      if (!plan.scenarios.some((scenario) => scenario.type === requiredType)) {
        issues.push(error('plan.scenarios', 'MISSING_REQUIRED_TYPE', `Plan must include at least one ${requiredType} scenario.`));
      }
    }

    const ids = new Set<string>();
    plan.scenarios.forEach((scenario, index) => {
      const path = `plan.scenarios.${index}`;
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

      validateEngineTarget(path, scenario, issues);
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

function validateExpectations(path: string, scenario: PlanValidatorContext['plan']['scenarios'][number], issues: ValidationIssue[]): void {
  const expectedStatus = scenario.expect?.status;
  if (expectedStatus === undefined) return;
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

function isReadonlyNumberArray(value: NonNullable<NonNullable<PlanValidatorContext['plan']['scenarios'][number]['expect']>['status']>): value is readonly number[] {
  return Array.isArray(value);
}

function error(path: string, code: string, message: string): ValidationIssue {
  return { severity: 'error', path, code, message };
}

function warning(path: string, code: string, message: string): ValidationIssue {
  return { severity: 'warning', path, code, message };
}
