# brisk-aitesting

AI-native modular testing for SaaS products, APIs, UI workflows, contracts, and custom systems.

The product promise is simple:

```text
Tell it what to test.
It discovers the app.
It chooses the right testing method.
It runs the tests.
It returns clean results your system can consume.
```

## Install

```bash
npm install brisk-aitesting
npx brisk-aitesting init
```

## Run

```bash
npx brisk-aitesting run "Test login, dashboard, APIs, permissions, and billing"
```

## Use As An SDK

```ts
import { createBriskAiTesting, defineConfig } from 'brisk-aitesting';

const config = defineConfig({
  app: {
    name: 'My SaaS',
    baseUrl: 'http://localhost:3000',
    repoPath: '.',
  },
  auth: { type: 'none' },
});

const tester = createBriskAiTesting(config);

const result = await tester.run({
  goal: 'Test login, dashboard, APIs, and permissions',
  scenarios: 15,
  mode: 'automatic',
});

console.log(result.summary);
```

## Lifecycle

```text
1. Receive goal
2. Read config
3. Create test plan
4. Validate the plan
5. Route each scenario to an engine
6. Run engines
7. Collect request/response, browser, log, and report artifacts
8. Return one stable handover object
```

Current built-in engines:

- `BuiltinPlaywrightEngine`: generates and executes real Playwright browser tests.
- `BuiltinApiEngine`: executes HTTP requests, checks status/body expectations, and writes request-response artifacts.
- `BuiltinContractEngine`: parses configured OpenAPI/AsyncAPI contract files.

Current built-in control-plane modules:

- `BuiltinDiscoverer`: discovers UI routes, API routes, contract files, and repo signals.
- `BuiltinPlanner`: creates scenarios from the user goal and discovery evidence.
- `AiPlanner`: turns AI provider JSON into normalized scenarios, then lets validation enforce safety before execution.
- `BuiltinPlanValidator`: blocks invalid plans before any engine executes.

## AI Planner Boundary

AI providers do not execute code. They return plan JSON. `brisk-aitesting` then:

```text
extracts JSON
-> repairs narrow syntax noise
-> normalizes aliases like browser -> ui and backend -> api
-> injects discovered routes when targets are missing
-> validates the plan
-> only then routes to engines
```

That keeps the user experience simple while keeping execution controlled.

## Real AI Providers

For the first real provider test, use DeepSeek. It is OpenAI-compatible and simple to wire:

```ts
import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: 'My SaaS',
    baseUrl: 'http://localhost:3000',
    repoPath: '.',
  },
  auth: { type: 'none' },
  ai: {
    provider: 'deepseek',
    model: requiredEnv('BRISK_AITESTING_AI_MODEL'),
    apiKeyEnv: 'BRISK_AITESTING_AI_API_KEY',
    caCertPath: process.env.BRISK_AITESTING_AI_CA_CERT_PATH,
    repairAttempts: 2,
    maxTokens: 4096,
    temperature: 0.1,
  },
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`${name} is required`);
  return value;
}
```

MiniMax uses the same adapter:

```ts
ai: {
  provider: 'minimax',
  model: requiredEnv('BRISK_AITESTING_AI_MODEL'),
  apiKeyEnv: 'BRISK_AITESTING_AI_API_KEY',
  caCertPath: process.env.BRISK_AITESTING_AI_CA_CERT_PATH,
  repairAttempts: 2,
}
```

`BRISK_AITESTING_*` is the recommended public namespace. Provider-specific names such as `MINIMAX_API_KEY` can be used as compatibility aliases in smoke tests, but product integrations should prefer the package namespace.

`caCertPath` is optional. Use it when Node.js cannot validate your provider's HTTPS certificate chain, usually on enterprise networks with a corporate root CA. Point it at a PEM certificate file instead of disabling TLS verification.

`repairAttempts` controls the validation-aware AI repair loop. The engine first validates the generated plan. If the plan is not executable, the validator issues are sent back to the AI planner for a corrected JSON plan. Test engines run only after validation passes.

You can also pass any OpenAI-compatible endpoint:

```ts
ai: {
  provider: 'openai-compatible',
  endpoint: 'http://localhost:11434/v1',
  model: 'your-model',
  apiKey: 'local-or-provider-key',
}
```

## Host App Config Bridge

Teams do not have to duplicate configuration. If their SaaS already has config values, map them into `brisk-aitesting`:

```ts
import { defineConfigFromHost, mergeConfig } from 'brisk-aitesting';

const testingConfig = defineConfigFromHost(hostConfig, (host) => ({
  app: {
    name: host.productName,
    baseUrl: host.urls.staging,
    repoPath: host.paths.repo,
  },
  auth: host.testing.auth,
  ai: {
    provider: 'deepseek',
    model: host.ai.model,
    apiKey: host.ai.apiKey,
    caCertPath: host.ai.caCertPath,
  },
}));

export default mergeConfig(testingConfig, {
  runtime: {
    artifactsDir: '.brisk-aitesting/artifacts',
    timeoutMs: 120000,
    retries: 1,
    headless: true,
    dryRun: false,
  },
});
```

## Handover Contract

The engine does not require a database. It returns a stable JSON object:

```ts
{
  schemaVersion: 'brisk-aitesting.result.v1',
  runId: string,
  status: 'passed' | 'failed' | 'error' | 'skipped',
  summary: {
    total: number,
    passed: number,
    failed: number,
    skipped: number,
    errors: number,
    passRate: number,
    durationMs: number
  },
  plan: {},
  tests: [],
  artifacts: [],
  diagnosis: [],
  handover: {}
}
```

Current stable schema names:

```text
brisk-aitesting.plan.v1
brisk-aitesting.validation.v1
brisk-aitesting.discovery.v1
brisk-aitesting.result.v1
brisk-aitesting.handover.v1
brisk-aitesting.api-evidence.v1
brisk-aitesting.openapi-summary.v1
brisk-aitesting.playwright-evidence.v1
brisk-aitesting.ui-grounding.v1
brisk-aitesting.ui-actions.v1
```

API request-response artifacts use this shape:

```json
{
  "schemaVersion": "brisk-aitesting.api-evidence.v1",
  "scenario": {
    "id": "scenario-id",
    "name": "Scenario name",
    "type": "api",
    "objective": "What this proves"
  },
  "request": {
    "method": "GET",
    "url": "http://localhost:3000/api/health",
    "headers": {}
  },
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": {},
    "body": {}
  },
  "assertions": [
    {
      "name": "status is 200",
      "status": "passed"
    }
  ]
}
```

OpenAPI contract artifacts summarize operations in a host-consumable shape:

```json
{
  "schemaVersion": "brisk-aitesting.openapi-summary.v1",
  "path": "./openapi.json",
  "title": "Host API",
  "version": "1.0.0",
  "openapiVersion": "3.0.3",
  "operations": [
    {
      "method": "GET",
      "path": "/api/health",
      "operationId": "getHealth",
      "tags": ["system"],
      "statusCodes": [200],
      "requestBodyRequired": false,
      "requestContentTypes": [],
      "responseContentTypes": ["application/json"]
    }
  ],
  "diagnostics": []
}
```

Playwright UI runs also produce a schema-versioned evidence manifest:

```json
{
  "schemaVersion": "brisk-aitesting.playwright-evidence.v1",
  "scenario": {},
  "target": {
    "route": "/",
    "url": "http://localhost:3000/"
  },
  "execution": {
    "exitCode": 0,
    "timedOut": false,
    "durationMs": 1000
  },
  "report": {
    "total": 1,
    "passed": 1,
    "failed": 0,
    "skipped": 0,
    "errors": 0
  },
  "artifacts": []
}
```

The raw Playwright JSON report, execution log, generated spec, trace, screenshots, and this manifest are all returned as `ArtifactRef` entries so host apps can store them as-is or render them in their own dashboard.

UI route grounding is captured separately:

```json
{
  "schemaVersion": "brisk-aitesting.ui-grounding.v1",
  "scenario": {
    "id": "scenario-id",
    "name": "Scenario name",
    "objective": "What this proves"
  },
  "route": "/login",
  "url": "http://localhost:3000/login",
  "title": "App",
  "elements": [
    {
      "id": "ui_el_001",
      "kind": "label",
      "role": "textbox",
      "label": "Email",
      "tagName": "input",
      "locator": {
        "strategy": "label",
        "value": "Email"
      },
      "confidence": 0.9
    }
  ],
  "summary": {
    "total": 1,
    "roles": {
      "textbox": 1
    },
    "labels": 1,
    "testIds": 0,
    "actionable": 1
  }
}
```

The product rule is: UI actions should be built from grounding evidence. AI can propose intent, but executable selectors must come from evidence-backed locators.

Grounded UI actions use evidence IDs from the grounding document:

```json
{
  "uiActions": [
    {
      "action": "fill",
      "evidenceId": "ui_el_001",
      "value": "user@example.com"
    },
    {
      "action": "click",
      "evidenceId": "ui_el_003"
    }
  ]
}
```

The engine resolves `evidenceId` to the captured locator evidence at runtime. If the evidence ID is missing, the action fails without trying to guess a selector.

For AI-driven action selection, enable the route grounding feedback loop:

```ts
await tester.run({
  goal: 'Test login using real page evidence',
  scenarios: 1,
  mode: 'automatic',
  uiActionFeedback: 'when-missing',
});
```

The loop is:

```text
plan route -> validate -> pre-ground route -> send evidence to planner -> enrich uiActions -> validate -> execute grounded actions
```

`uiActionFeedback` can be:

```text
off           do not ask for action enrichment
when-missing  enrich only UI scenarios that do not already have uiActions
always        re-enrich UI actions from fresh route grounding
```

Your SaaS decides what to do with it: store it in Postgres, attach it to CI, render it in a dashboard, or send it to observability.

## Architecture

```text
User goal
  -> planner
  -> engine router
  -> UI/API/contract/replay/custom engines
  -> result handover
```

AI is the planner and judge. Engines are the machines. Validators and result contracts keep the system precise.
