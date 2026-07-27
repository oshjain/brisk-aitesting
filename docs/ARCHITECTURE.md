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

9. Benchmark Boundary
   `npm run benchmark` emits `brisk-aitesting.benchmark.v1`.
   Benchmark cases are deterministic adversarial checks for failure-mode stability.

10. Release Pack Boundary
   `npm run pack:check` emits `brisk-aitesting.pack-check.v1`.
   Pack check verifies distributable files and blocks secrets, smoke fixtures, and generated artifacts from the npm tarball.

11. Engine Plugin Conformance Boundary
   `runEnginePluginConformance` emits `brisk-aitesting.plugin-conformance.v1`.
   Engine plugins must prove they accept only their own scenarios, reject unrelated scenarios, return stable `ScenarioResult` objects, respect runtime timeout, avoid obvious secret leakage, and emit valid artifact shapes.
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
| `brisk-aitesting.benchmark.v1` | benchmark | Deterministic adversarial benchmark report |
| `brisk-aitesting.pack-check.v1` | release | npm package tarball verification report |
| `brisk-aitesting.engine-conformance.v1` | conformance | Built-in engine behavior report |
| `brisk-aitesting.plugin-conformance.v1` | conformance | External engine plugin behavior report |
| `brisk-aitesting.plugin-conformance-smoke.v1` | conformance | Smoke proof that good plugins pass and bad plugins fail |
| `brisk-aitesting.reference-serious-saas.v1` | reference app | Serious SaaS reference smoke report |
| `brisk-aitesting.golden-fixtures.v1` | golden fixtures | Stable scenario/result baseline report |
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
npm run smoke:contracts
npm run smoke:engine-conformance
npm run smoke:plugin-conformance
npm run smoke:reference-serious-saas
npm run smoke:golden-fixtures
npm run smoke:cli
npm run smoke:ai-fixtures
npm run smoke
npm run benchmark
npm run pack:check
```

`npm run smoke:ci` runs the deterministic gate used by GitHub Actions. It includes pack-check and excludes real provider calls.

`smoke:real-ai` requires provider credentials and enterprise CA config when applicable. It is available through the manual `Real AI Smoke` workflow and proves the configured provider path works, but benchmark-level provider quality is a separate track.

## Current Boundaries

Built:

- Provider-agnostic AI planning adapter.
- Plan validation and repair.
- Route grounding feedback loop.
- Grounded UI action execution.
- OpenAPI JSON/YAML route discovery, schema extraction, generated API scenarios, and response schema validation.
- Evidence-rich API/UI artifacts.
- Host handover contract.
- Engine conformance smoke for built-in engines.
- Engine plugin conformance API and smoke gate for external `Engine` implementations.
- Serious SaaS reference app smoke.
- Golden fixture baseline for serious SaaS scenario/result stability.

Still intentionally incomplete:

- Benchmark-level multi-provider scoring.
- JUnit/HTML CI report generation.
- Public npm publishing automation.
- Metrics/analytics module.
- Conformance suites for external `Discoverer`, `Planner`, `PlanValidator`, `UiRouteGrounder`, and `AiPlannerProvider` implementations.
