import { Ajv, type ErrorObject } from 'ajv';
import type { ValidationIssue } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export const resultJsonSchema = {
  $id: 'brisk-aitesting.result.v1',
  type: 'object',
  additionalProperties: true,
  required: ['schemaVersion', 'runId', 'status', 'app', 'goal', 'discovery', 'plan', 'summary', 'tests', 'artifacts', 'diagnosis', 'handover'],
  properties: {
    schemaVersion: { const: 'brisk-aitesting.result.v1' },
    runId: { type: 'string', minLength: 1 },
    status: { enum: ['passed', 'failed', 'error', 'skipped'] },
    app: { type: 'object' },
    goal: { type: 'string', minLength: 1 },
    discovery: { type: 'object' },
    plan: { type: 'object' },
    summary: {
      type: 'object',
      required: ['total', 'passed', 'failed', 'skipped', 'errors', 'passRate', 'durationMs'],
      properties: {
        total: { type: 'integer', minimum: 0 },
        passed: { type: 'integer', minimum: 0 },
        failed: { type: 'integer', minimum: 0 },
        skipped: { type: 'integer', minimum: 0 },
        errors: { type: 'integer', minimum: 0 },
        passRate: { type: 'number', minimum: 0, maximum: 100 },
        durationMs: { type: 'number', minimum: 0 },
      },
    },
    tests: {
      type: 'array',
      items: { $ref: '#/$defs/scenarioResult' },
    },
    artifacts: {
      type: 'array',
      items: { $ref: '#/$defs/artifact' },
    },
    diagnosis: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reason', 'suggestedFixes'],
        properties: {
          scenarioId: { type: 'string' },
          reason: { type: 'string' },
          suggestedFixes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    handover: { type: 'object' },
  },
  $defs: {
    scenarioResult: {
      type: 'object',
      required: ['scenarioId', 'name', 'type', 'engine', 'status', 'durationMs', 'assertions', 'artifacts', 'diagnostics'],
      properties: {
        scenarioId: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        type: { enum: ['ui', 'api', 'contract', 'schema', 'replay', 'message', 'custom'] },
        engine: { type: 'string', minLength: 1 },
        status: { enum: ['passed', 'failed', 'error', 'skipped'] },
        durationMs: { type: 'number', minimum: 0 },
        assertions: { type: 'array' },
        artifacts: { type: 'array' },
        diagnostics: { type: 'array', items: { type: 'string' } },
      },
    },
    artifact: {
      type: 'object',
      required: ['kind', 'label'],
      properties: {
        kind: { enum: ['json', 'junit', 'html', 'trace', 'screenshot', 'video', 'test-file', 'log', 'other'] },
        path: { type: 'string' },
        url: { type: 'string' },
        label: { type: 'string' },
        metadata: { type: 'object' },
      },
    },
  },
} as const;

export const handoverJsonSchema = {
  $id: 'brisk-aitesting.handover.v1',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'generatedAt', 'resultSchema', 'storage', 'consumers'],
  properties: {
    schemaVersion: { const: 'brisk-aitesting.handover.v1' },
    generatedAt: { type: 'string', minLength: 1 },
    resultSchema: { const: 'brisk-aitesting.result.v1' },
    storage: {
      type: 'object',
      additionalProperties: false,
      required: ['required', 'recommendedKeys', 'artifactRoot'],
      properties: {
        required: { const: false },
        recommendedKeys: { type: 'array', items: { type: 'string' } },
        artifactRoot: { type: 'string' },
      },
    },
    consumers: {
      type: 'object',
      additionalProperties: false,
      required: ['database', 'ci', 'dashboard'],
      properties: {
        database: { type: 'string' },
        ci: { type: 'string' },
        dashboard: { type: 'string' },
      },
    },
  },
} as const;

const validateResult = ajv.compile(resultJsonSchema);
const validateHandover = ajv.compile(handoverJsonSchema);

export function validateResultJsonContract(value: unknown): readonly ValidationIssue[] {
  return validateWith(validateResult(value) === true, validateResult.errors ?? [], 'result');
}

export function validateHandoverJsonContract(value: unknown): readonly ValidationIssue[] {
  return validateWith(validateHandover(value) === true, validateHandover.errors ?? [], 'handover');
}

function validateWith(valid: boolean, errors: ErrorObject[], root: string): readonly ValidationIssue[] {
  if (valid) return [];
  return errors.map((error) => ({
    severity: 'error',
    path: jsonPointerToPath(root, error.instancePath),
    code: `JSON_CONTRACT_${error.keyword.toUpperCase()}`,
    message: `${root} contract violation: ${error.message ?? error.keyword}.`,
  }));
}

function jsonPointerToPath(root: string, pointer: string): string {
  if (pointer.length === 0) return root;
  return `${root}.${pointer.split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).join('.')}`;
}
