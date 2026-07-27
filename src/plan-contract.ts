import { Ajv, type ErrorObject } from 'ajv';
import type { ValidationIssue } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export const planJsonSchema = {
  $id: 'brisk-aitesting.plan.v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'runId', 'goal', 'mode', 'scenarios', 'discovery', 'warnings', 'createdAt'],
  properties: {
    schemaVersion: { const: 'brisk-aitesting.plan.v1' },
    runId: { type: 'string', minLength: 1 },
    goal: { type: 'string', minLength: 1 },
    mode: { enum: ['automatic', 'ui', 'api', 'contract', 'schema', 'replay', 'custom'] },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
    createdAt: { type: 'string', minLength: 1 },
    discovery: {
      type: 'object',
      additionalProperties: true,
      required: ['schemaVersion', 'app', 'uiRoutes', 'apiRoutes', 'contracts', 'repoSignals', 'warnings', 'createdAt'],
      properties: {
        schemaVersion: { const: 'brisk-aitesting.discovery.v1' },
        app: { type: 'object' },
        uiRoutes: { type: 'array' },
        apiRoutes: { type: 'array' },
        contracts: { type: 'array' },
        repoSignals: { type: 'array' },
        warnings: { type: 'array', items: { type: 'string' } },
        createdAt: { type: 'string' },
      },
    },
    scenarios: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/scenario' },
    },
  },
  $defs: {
    scenario: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'type', 'objective', 'assertions', 'evidenceRequired'],
      properties: {
        id: { type: 'string', minLength: 1, pattern: '^[A-Za-z_$][A-Za-z0-9_$-]*$' },
        name: { type: 'string', minLength: 1 },
        type: { enum: ['ui', 'api', 'contract', 'schema', 'replay', 'custom'] },
        objective: { type: 'string', minLength: 1 },
        target: {
          type: 'object',
          additionalProperties: false,
          properties: {
            method: { type: 'string' },
            path: { type: 'string' },
            route: { type: 'string' },
            schema: { type: 'string' },
          },
        },
        request: {
          type: 'object',
          additionalProperties: false,
          properties: {
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            query: {
              type: 'object',
              additionalProperties: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
              },
            },
            body: {},
          },
        },
        expect: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: {
              anyOf: [
                { type: 'integer', minimum: 100, maximum: 599 },
                {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'integer', minimum: 100, maximum: 599 },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    min: { type: 'integer', minimum: 100, maximum: 599 },
                    max: { type: 'integer', minimum: 100, maximum: 599 },
                  },
                },
              ],
            },
            json: { type: 'object' },
            contains: { type: 'string' },
          },
        },
        assertions: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        uiActions: {
          type: 'array',
          items: { $ref: '#/$defs/uiAction' },
        },
        evidenceRequired: {
          type: 'array',
          minItems: 1,
          items: { enum: ['repo', 'ui', 'api', 'schema', 'auth'] },
        },
        metadata: {
          type: 'object',
          additionalProperties: true,
        },
      },
    },
    uiAction: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'evidenceId'],
      properties: {
        action: { enum: ['fill', 'click', 'check', 'select', 'press', 'assertText'] },
        evidenceId: { type: 'string', pattern: '^ui_el_\\d{3,}$' },
        value: { type: 'string' },
        key: { type: 'string' },
        text: { type: 'string' },
        description: { type: 'string' },
      },
      allOf: [
        {
          if: { properties: { action: { enum: ['fill', 'select'] } }, required: ['action'] },
          then: { required: ['value'] },
        },
        {
          if: { properties: { action: { const: 'press' } }, required: ['action'] },
          then: { required: ['key'] },
        },
        {
          if: { properties: { action: { const: 'assertText' } }, required: ['action'] },
          then: { required: ['text'] },
        },
      ],
    },
  },
} as const;

const validatePlan = ajv.compile(planJsonSchema);

export function validatePlanJsonContract(value: unknown): readonly ValidationIssue[] {
  const valid = validatePlan(value) === true;
  if (valid) return [];
  return (validatePlan.errors ?? []).map(toIssue);
}

function toIssue(error: ErrorObject): ValidationIssue {
  const path = jsonPointerToPlanPath(error.instancePath);
  if (error.keyword === 'additionalProperties') {
    const property = typeof error.params.additionalProperty === 'string' ? error.params.additionalProperty : 'unknown';
    return {
      severity: 'error',
      path: `${path}.${property}`,
      code: 'PLAN_CONTRACT_UNRECOGNIZED_KEY',
      message: `Plan contract does not allow "${property}" at ${path}.`,
    };
  }
  if (error.keyword === 'required') {
    const missing = typeof error.params.missingProperty === 'string' ? error.params.missingProperty : 'unknown';
    return {
      severity: 'error',
      path: `${path}.${missing}`,
      code: 'PLAN_CONTRACT_REQUIRED',
      message: `Plan contract requires "${missing}" at ${path}.`,
    };
  }
  if (error.keyword === 'enum' || error.keyword === 'const') {
    return {
      severity: 'error',
      path,
      code: 'PLAN_CONTRACT_INVALID_VALUE',
      message: `Plan contract received an unsupported value at ${path}.`,
    };
  }
  return {
    severity: 'error',
    path,
    code: 'PLAN_CONTRACT_INVALID_SHAPE',
    message: `Plan contract violation at ${path}: ${error.message ?? error.keyword}.`,
  };
}

function jsonPointerToPlanPath(pointer: string): string {
  if (pointer.length === 0) return 'plan';
  const parts = pointer
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  return `plan.${parts.join('.')}`;
}
