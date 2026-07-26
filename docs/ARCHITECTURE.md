# brisk-aitesting Architecture

This package is a provider-agnostic AI testing engine. The core promise is simple:

```text
goal -> discovery -> AI plan -> validation/repair -> grounding -> execution -> evidence -> handover
```

The product must hide complexity from host apps while keeping every internal boundary explicit and testable.

## Non-Negotiable Rules

- AI providers do not execute code.
- AI providers do not produce executable Playwright scripts.
- UI selectors are never accepted directly from AI.
- UI actions execute only through `ui_el_*` evidence IDs from `brisk-aitesting.ui-grounding.v1`.
- Engines run only after the plan validates.
- Broken plans repair through a structured validation feedback loop.
- Every executable run must produce evidence artifacts.
- Product configuration uses `BRISK_AITESTING_*` as the primary namespace. Provider-specific env vars are aliases only.
- Host apps own storage. This package returns stable handover JSON and artifact references.

## Pipeline

```text
1. Config
   defineConfig / defineConfigFromHost / loadConfig / loadEnvFiles

2. Discovery
   BuiltinDiscoverer finds UI routes, API routes, contracts, and repo signals.

3. Planning
    Planner returns `brisk-aitesting.plan.v1`.
    AiPlanner requests JSON only from an AiPlannerProvider.
    BuiltinPlanner can generate API scenarios from OpenAPI operations.

4. Validation And Repair
   BuiltinPlanValidator checks structural executability.
   AiPlanner.repair can fix invalid plans using validator issues.

5. Route Grounding Feedback
   Optional `uiActionFeedback` pre-grounds UI routes.
   Planner.enrichUiActions receives real `brisk-aitesting.ui-grounding.v1` evidence.

6. Execution
    BuiltinApiEngine executes API scenarios.
    BuiltinApiEngine validates JSON responses against OpenAPI response schemas when available.
    BuiltinPlaywrightEngine executes UI scenarios and grounded UI actions.
    BuiltinContractEngine parses OpenAPI JSON/YAML contracts and emits operation summaries.

7. Evidence And Handover
   Engines produce schema-versioned evidence artifacts.
   buildResult returns `brisk-aitesting.result.v1` plus `brisk-aitesting.handover.v1`.

8. CLI Boundary
   `brisk-aitesting run --json` returns `brisk-aitesting.cli-result.v1`.
   Exit codes are stable: 0 passed, 1 completed non-passed, 2 setup/usage error.
```

## Schema Registry

Stable schema names currently used by the package:

| Schema | Owner | Purpose |
| --- | --- | --- |
| `brisk-aitesting.plan.v1` | planner | Structured test plan |
| `brisk-aitesting.validation.v1` | validator | Plan validation result |
| `brisk-aitesting.discovery.v1` | discoverer | Discovered app surface |
| `brisk-aitesting.result.v1` | handover | Full run result |
| `brisk-aitesting.handover.v1` | handover | Host consumption contract |
| `brisk-aitesting.cli-result.v1` | CLI | Machine-readable CLI run summary |
| `brisk-aitesting.api-evidence.v1` | API engine | Request/response evidence |
| `brisk-aitesting.openapi-summary.v1` | contract engine/discoverer | OpenAPI JSON/YAML operation summary |
| `brisk-aitesting.playwright-evidence.v1` | UI engine | UI execution manifest |
| `brisk-aitesting.ui-grounding.v1` | UI grounder/engine | Real page element evidence |
| `brisk-aitesting.ui-actions.v1` | UI engine | Executed grounded action evidence |

Any new schema must be documented here and covered by smoke tests before it is treated as stable.

## Extension Points

Host apps and integrators can replace these interfaces:

- `AiPlannerProvider`
- `Planner`
- `PlanValidator`
- `Discoverer`
- `Engine`
- `UiRouteGrounder`

The orchestrator should remain small. New domain behavior should usually enter through one of these extension points.

## UI Grounding Model

The UI flow is intentionally two-step:

```text
route -> grounding evidence -> action enrichment -> grounded action execution
```

`UiElementEvidence` records real page elements with:

- `id`
- role/label/text/test id/CSS fallback
- locator strategy
- confidence

`UiActionPlan` uses only `evidenceId` plus action intent:

```json
{
  "action": "click",
  "evidenceId": "ui_el_003"
}
```

The engine resolves `evidenceId` to captured evidence. If the evidence ID is missing, execution fails without guessing.

## Stability Gates

Before a change is considered product-safe, run:

```bash
npm run typecheck
npm run build
npm run smoke
npm run smoke:contracts
npm run smoke:ai-fixtures
npm run smoke:real-ai
```

`smoke:real-ai` requires provider credentials and enterprise CA config when applicable. It proves the configured provider path works, but benchmark-level provider quality is a separate track.

## Current Boundaries

Built:

- Provider-agnostic AI planning adapter.
- Plan validation and repair.
- Route grounding feedback loop.
- Grounded UI action execution.
- Evidence-rich API/UI artifacts.
- Host handover contract.

Still intentionally incomplete:

- Benchmark-level multi-provider scoring.
- Deep API contract/schema execution.
- JUnit/HTML CI report generation.
- Publishing hardening and public package release checks.
- Metrics/analytics module.
