# API Reference

This is the public SDK surface most host apps need.

## createBriskAiTesting

```ts
import { createBriskAiTesting } from 'brisk-aitesting';

const tester = createBriskAiTesting(config);
const result = await tester.run({
  goal: 'Test login, dashboard, API contracts, and permissions',
  scenarios: 10,
  mode: 'automatic',
});
```

## Run Input

| Field | Type | Meaning |
|:------|:-----|:--------|
| `goal` | `string` | What should be tested |
| `scenarios` | `number` | Desired scenario count |
| `mode` | `automatic`, `ui`, `api`, `contract`, `schema`, `replay`, `custom` | How scenarios should be routed |
| `requiredTypes` | array | Force at least one scenario of a type |
| `uiActionFeedback` | `off`, `when-missing`, `always` | Whether UI actions should be grounded before execution |
| `metadata` | object | Host-owned metadata |

## Result

Every run returns `brisk-aitesting.result.v1`.

Important fields:

| Field | Meaning |
|:------|:--------|
| `runId` | Unique run id |
| `status` | Overall status |
| `summary` | Totals, pass rate, duration |
| `discovery` | What Brisk found |
| `plan` | The checked scenario plan |
| `tests` | Scenario-level results |
| `artifacts` | Evidence files |
| `diagnosis` | Failure reasons and next checks |
| `handover` | How host apps can store or consume the result |

## Plan Contract Gate

Every executable plan must match `brisk-aitesting.plan.v1`.

```ts
import { planJsonSchema, validatePlanJsonContract } from 'brisk-aitesting';

const issues = validatePlanJsonContract(candidatePlan);
if (issues.length > 0) {
  // Show these issues to the user or send them back to the planner for repair.
}
```

Use `planJsonSchema` when a host app wants to validate plans with its own JSON Schema tooling. Use `validatePlanJsonContract` when it wants the same issue shape Brisk uses internally.

## Events

```ts
const unsubscribe = tester.onEvent((event) => {
  console.log(event.type);
});
```

Useful event types:

- `run.started`
- `discovery.completed`
- `plan.created`
- `plan.validated`
- `plan.repair.started`
- `scenario.started`
- `scenario.completed`
- `run.completed`

## Custom Engines

Engines let host teams add coverage outside the built-in UI/API/contract scope.

```ts
const engine = {
  name: 'custom-engine',
  type: 'custom',
  canRun: (scenario) => scenario.type === 'custom',
  run: async (context) => ({
    result: {
      scenarioId: context.scenario.id,
      name: context.scenario.name,
      type: context.scenario.type,
      engine: 'custom-engine',
      status: 'passed',
      durationMs: 1,
      assertions: [{ name: 'custom check passed', status: 'passed' }],
      artifacts: [],
      diagnostics: [],
    },
  }),
};
```

Before trusting a custom engine, run it through `runEnginePluginConformance`.
