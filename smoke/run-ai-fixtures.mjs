import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuiltinDiscoverer,
  BuiltinPlanValidator,
  createBriskAiTesting,
  defineConfig,
  parseAiPlanForTesting,
  validatePlanJsonContract,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const server = createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body><main>Fixture app</main></body></html>');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');

try {
  const config = defineConfig({
    app: {
      name: 'AI fixture app',
      baseUrl: `http://127.0.0.1:${address.port}`,
      repoPath: join(here, 'site'),
      env: 'local',
    },
    auth: { type: 'none' },
    ai: {
      provider: 'minimax',
      model: 'fixture-model',
      apiKeyEnv: 'BRISK_AITESTING_AI_API_KEY',
      repairAttempts: 1,
    },
    runtime: {
      artifactsDir: '.brisk-aitesting-fixtures/artifacts',
      timeoutMs: 30000,
      retries: 0,
      headless: true,
      dryRun: false,
    },
    discovery: {
      includeRepo: true,
      includeUi: true,
      includeApi: true,
      includeContracts: false,
    },
    security: {
      networkPolicy: 'localhost-only',
      allowedHosts: ['localhost', '127.0.0.1'],
      redactSecrets: true,
    },
  });
  const runId = `fixture_${randomUUID()}`;
  const discoverer = new BuiltinDiscoverer();
  const discovery = await discoverer.discover({ config, input: { goal: 'fixture coverage' }, runId });
  const context = { config, input: { goal: 'fixture coverage', scenarios: 2, mode: 'automatic', requiredTypes: ['ui', 'api'] }, runId, discovery };
  const validator = new BuiltinPlanValidator();

  const fixtures = [
    {
      name: 'markdown fenced json with trailing commas',
      content: '```json\n{ "mode": "automatic", "warnings": ["ok",], "scenarios": [{ "name": "Home", "type": "browser", "target": { "route": "/" }, "assertions": ["visible"], "evidenceRequired": ["ui"], },] }\n```',
      assert(plan) {
        assertHasType(plan, 'ui');
      },
    },
    {
      name: 'json-ish object with unquoted keys',
      content: '{ mode: "automatic", scenarios: [{ name: "Home", type: "browser", target: { route: "/" }, assertions: ["visible"], evidenceRequired: ["ui"] }] }',
      assert(plan) {
        assertHasType(plan, 'ui');
      },
    },
    {
      name: 'top-level testPlan wrapper and tests alias',
      content: JSON.stringify({
        testPlan: {
          mode: 'automatic',
          tests: [
            {
              name: 'Health alias',
              type: 'backend',
              objective: 'health responds',
              target: { method: 'read', path: 'api/health?x=1' },
              expected: { statusCode: '200', json: { ok: true } },
              assertions: ['status is ok'],
              evidenceRequired: ['api'],
            },
          ],
        },
      }),
      assert(plan) {
        const api = assertHasType(plan, 'api');
        if (api.target?.method !== 'GET') throw new Error('expected read alias to normalize to GET');
        if (api.target?.path !== '/api/health') throw new Error(`expected normalized path /api/health, got ${api.target?.path}`);
        if (api.expect?.status !== 200) throw new Error('expected string status to normalize to number 200');
      },
    },
    {
      name: 'duplicate ids are repaired by orchestrator',
      content: JSON.stringify({
        mode: 'automatic',
        scenarios: [
          {
            id: 'same_id',
            name: 'First duplicate',
            type: 'ui',
            objective: 'first duplicate',
            target: { route: '/' },
            assertions: ['visible'],
            evidenceRequired: ['ui'],
          },
          {
            id: 'same_id',
            name: 'Second duplicate',
            type: 'api',
            objective: 'second duplicate',
            target: { method: 'GET', path: '/api/health' },
            expect: { status: 200 },
            assertions: ['ok'],
            evidenceRequired: ['api'],
          },
        ],
      }),
      expectValidationError: 'DUPLICATE_ID',
    },
    {
      name: 'legacy tests alias and integration category',
      content: JSON.stringify({
        mode: 'automatic',
        tests: [
          {
            name: 'Workflow loads dashboard',
            category: 'integration',
            objective: 'workflow route loads',
            target: { url: 'http://example.test//dashboard/?from=ai' },
            assertions: ['dashboard visible'],
            evidenceRequired: ['ui'],
          },
        ],
      }),
      assert(plan) {
        const ui = assertHasType(plan, 'ui');
        if (ui.target?.route !== '/dashboard') throw new Error(`expected /dashboard, got ${ui.target?.route}`);
      },
    },
    {
      name: 'natural language refusal is rejected',
      content: 'I cannot generate tests for this application without more information.',
      expectParseError: 'AI planner did not return a JSON object',
    },
  ];

  const errors = [];
  for (const fixture of fixtures) {
    try {
      const plan = parseAiPlanForTesting(fixture.content, context);
      const validation = validator.validate({ config, input: context.input, plan });
      const codes = validation.issues.map((issue) => issue.code);
      if (fixture.expectParseError !== undefined) {
        errors.push(`${fixture.name}: expected parse error ${fixture.expectParseError}`);
      } else if (fixture.expectValidationError !== undefined) {
        if (!codes.includes(fixture.expectValidationError)) errors.push(`${fixture.name}: expected validation error ${fixture.expectValidationError}, got ${codes.join(',')}`);
      } else if (!validation.valid) {
        errors.push(`${fixture.name}: expected valid plan, got ${codes.join(',')}`);
      } else {
        fixture.assert?.(plan);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (fixture.expectParseError === undefined || !message.includes(fixture.expectParseError)) {
        errors.push(`${fixture.name}: ${message}`);
      }
    }
  }

  const contractFixtures = [
    {
      name: 'scenario-level headers are rejected',
      plan: {
        ...validPlanSkeleton(context),
        scenarios: [
          {
            ...validApiScenario(),
            headers: { authorization: 'Bearer token' },
          },
        ],
      },
      code: 'PLAN_CONTRACT_UNRECOGNIZED_KEY',
      path: 'plan.scenarios.0.headers',
    },
    {
      name: 'unsupported category field is rejected',
      plan: {
        ...validPlanSkeleton(context),
        scenarios: [
          {
            ...validApiScenario(),
            category: 'integration',
          },
        ],
      },
      code: 'PLAN_CONTRACT_UNRECOGNIZED_KEY',
      path: 'plan.scenarios.0.category',
    },
    {
      name: 'unsupported type value is rejected',
      plan: {
        ...validPlanSkeleton(context),
        scenarios: [
          {
            ...validApiScenario(),
            type: 'integration',
          },
        ],
      },
      code: 'PLAN_CONTRACT_INVALID_VALUE',
      path: 'plan.scenarios.0.type',
    },
    {
      name: 'missing evidence is rejected',
      plan: {
        ...validPlanSkeleton(context),
        scenarios: [
          {
            id: 'missing_evidence',
            name: 'Missing evidence',
            type: 'api',
            objective: 'must be rejected',
            target: { method: 'GET', path: '/api/health' },
            assertions: ['status is ok'],
          },
        ],
      },
      code: 'PLAN_CONTRACT_REQUIRED',
      path: 'plan.scenarios.0.evidenceRequired',
    },
    {
      name: 'invalid ui action value contract is rejected',
      plan: {
        ...validPlanSkeleton(context),
        scenarios: [
          {
            id: 'bad_ui_action',
            name: 'Bad UI action',
            type: 'ui',
            objective: 'must be rejected',
            target: { route: '/' },
            assertions: ['page visible'],
            evidenceRequired: ['ui'],
            uiActions: [{ action: 'fill', evidenceId: 'ui_el_001' }],
          },
        ],
      },
      code: 'PLAN_CONTRACT_REQUIRED',
      path: 'plan.scenarios.0.uiActions.0.value',
    },
  ];

  for (const fixture of contractFixtures) {
    const issues = validatePlanJsonContract(fixture.plan);
    if (!issues.some((issue) => issue.code === fixture.code && issue.path === fixture.path)) {
      errors.push(`${fixture.name}: expected ${fixture.code} at ${fixture.path}, got ${JSON.stringify(issues)}`);
    }
  }

  const duplicateRepairProvider = {
    name: 'duplicate-repair-provider',
    calls: 0,
    async complete() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          content: JSON.stringify({
            mode: 'automatic',
            scenarios: [
              {
                id: 'same_id',
                name: 'Duplicate UI',
                type: 'ui',
                objective: 'load page',
                target: { route: '/' },
                assertions: ['visible'],
                evidenceRequired: ['ui'],
              },
              {
                id: 'same_id',
                name: 'Duplicate API',
                type: 'api',
                objective: 'health responds',
                target: { method: 'GET', path: '/api/health' },
                expect: { status: 200 },
                assertions: ['ok'],
                evidenceRequired: ['api'],
              },
            ],
          }),
        };
      }
      return {
        content: JSON.stringify({
          mode: 'automatic',
          warnings: ['duplicate id repaired'],
          scenarios: [
            {
              id: 'fixed_ui',
              name: 'Fixed UI',
              type: 'ui',
              objective: 'load page',
              target: { route: '/' },
              assertions: ['visible'],
              evidenceRequired: ['ui'],
            },
            {
              id: 'fixed_api',
              name: 'Fixed API',
              type: 'api',
              objective: 'health responds',
              target: { method: 'GET', path: '/api/health' },
              expect: { status: 200 },
              assertions: ['ok'],
              evidenceRequired: ['api'],
            },
          ],
        }),
      };
    },
  };
  const repairEvents = [];
  const tester = createBriskAiTesting({
    ...config,
    aiProvider: duplicateRepairProvider,
  });
  tester.onEvent((event) => {
    if (event.type === 'plan.repair.started') repairEvents.push(event.attempt);
  });
  const repairedResult = await tester.run({
    goal: 'Repair duplicate ids',
    scenarios: 2,
    mode: 'automatic',
    requiredTypes: ['ui', 'api'],
  });
  if (duplicateRepairProvider.calls !== 2) errors.push(`expected provider to be called twice, got ${duplicateRepairProvider.calls}`);
  if (repairEvents.length !== 1) errors.push(`expected one repair event, got ${repairEvents.length}`);
  if (repairedResult.summary.passed !== 2) errors.push(`expected repaired run to pass 2, got ${repairedResult.summary.passed}`);
  if (repairedResult.plan.warnings[0] !== 'duplicate id repaired') errors.push('expected repaired warning to be preserved');

  if (errors.length > 0) {
    console.error(JSON.stringify({ status: 'failed', errors }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      status: 'passed',
      fixtures: fixtures.length,
      contractFixtures: contractFixtures.length,
      repairedRun: repairedResult.summary,
      repairEvents: repairEvents.length,
    }, null, 2));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function assertHasType(plan, type) {
  const scenario = plan.scenarios.find((candidate) => candidate.type === type);
  if (scenario === undefined) throw new Error(`expected ${type} scenario`);
  return scenario;
}

function validPlanSkeleton(context) {
  return {
    schemaVersion: 'brisk-aitesting.plan.v1',
    runId: context.runId,
    goal: context.input.goal,
    mode: 'automatic',
    scenarios: [],
    discovery: context.discovery,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

function validApiScenario() {
  return {
    id: 'valid_api',
    name: 'Valid API',
    type: 'api',
    objective: 'health responds',
    target: { method: 'GET', path: '/api/health' },
    expect: { status: 200 },
    assertions: ['status is ok'],
    evidenceRequired: ['api'],
  };
}
