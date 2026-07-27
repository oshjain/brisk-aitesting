# brisk-aitesting Status

This package is an alpha release. It already runs real checks, but we are still building toward the larger vision.

The rule is simple: AI can suggest what to test, but Brisk checks the plan before anything runs. Engines do the execution. Evidence records what happened.

## Built

- Provider-agnostic AI planner adapter.
- AJV-backed public plan contract gate: `brisk-aitesting.plan.v1`.
- Validation and repair loop for AI-generated plans after the public contract gate.
- CLI run workflow with stable exit codes and `brisk-aitesting.cli-result.v1`.
- Cleanup workflow with dry-run/json output: `brisk-aitesting.clean-result.v1`.
- SDK entry point with stable result and handover objects.
- JUnit and HTML report artifacts for every run: `brisk-aitesting.junit-report.v1` and `brisk-aitesting.html-report.v1`.
- OpenAPI JSON/YAML parsing.
- Built-in lightweight OpenAPI schema fuzz engine: `brisk-aitesting.schema-fuzz-evidence.v1`.
- Built-in replay engine for declared HTTP interactions: `brisk-aitesting.replay-evidence.v1`.
- OpenAPI route discovery, schema extraction, generated API scenarios, and response schema validation.
- Implementation-vs-OpenAPI drift report: `brisk-aitesting.contract-drift.v1`.
- Playwright UI execution with grounded locator evidence.
- UI route grounding feedback loop.
- API, OpenAPI, contract drift, Playwright, UI grounding, UI action, result, handover, CLI, and benchmark schemas.
- Deterministic release check: one command proves the main product paths still work.
- Manual real AI provider check: proves the configured AI provider works in this environment.
- Benchmark report with bad-input, contract drift, schema mismatch, network policy, and CLI failure checks: `brisk-aitesting.benchmark.v1`.
- Release pack check: `brisk-aitesting.pack-check.v1`.
- Adapter manifest: `brisk-aitesting.adapter-manifest.v1`.
- Adapter readiness gate: `brisk-aitesting.adapter-readiness.v1`.
- Built-in engine quality report: `brisk-aitesting.engine-conformance.v1`.
- External engine quality API and health-check report: `brisk-aitesting.plugin-conformance.v1`.
- Non-engine extension quality API and health-check report: `brisk-aitesting.extension-conformance.v1`.
- Optional Schemathesis OpenAPI deep API checker and run report: `brisk-aitesting.schemathesis-smoke.v1`.
- Schemathesis adapter readiness now requires real event evidence, selected operations, successful scenarios, saved artifacts, CI workflow wiring, docs, package inclusion, and plugin quality proof.
- Serious SaaS proof app report: `brisk-aitesting.reference-serious-saas.v1`.
- API-only, Todo, and multi-tenant proof app report: `brisk-aitesting.reference-proof-apps.v1`.
- Golden expected-output report: `brisk-aitesting.golden-fixtures.v1`.
- Release readiness check and versioned changelog: `brisk-aitesting.release-readiness.v1`.
- npm package publication path.

## Partly Built

- UI workflow generation is grounded and executable, but complex multi-page journeys still need broader proof coverage.
- OpenAPI scenario generation handles common request/response schemas, but deeper OpenAPI and JSON Schema coverage will keep expanding.
- Contract drift detection compares OpenAPI operations with repo/runtime API routes discovered from supported JavaScript/TypeScript patterns. It now covers direct Express-style routes, nested router prefixes, `router.route(...).get(...)` chains, Nest-style controller/method decorators, and common `:id` versus `{id}` parameter route shapes. Coverage still needs expansion for dynamic route composition, generated routes, and non-JS/TS backend source discovery.
- Analytics exist as structured summaries and benchmark reports, but richer trend analytics are future work.
- Business-intent scenarios can be expressed in goals/objectives/assertions, but reusable rule IDs, rule coverage, and contradiction checks are future work.
- Scenario routing already understands `schema`, `replay`, and `custom` types. Schemathesis covers optional deep OpenAPI checking now. Built-in replay covers declared HTTP interactions.

## Not Built Yet

- AI does not execute code.
- AI-generated Playwright code is not accepted.
- AI-generated selectors are not trusted.
- Real provider quality is not compared across multiple AI models yet.
- Built-in Specmatic, Keploy, AsyncAPI, Pact, or message-contract adapters.
- Full proof app collection beyond serious-saas, API-only, Todo, and multi-tenant.
- Formal UI selector healing stage with before/after evidence diffing.

## Next Work

- Add proof apps: E-commerce and Event/messaging.
- Add more golden expected outputs for stable plan/result comparison.
- Add source-route discovery adapters for Python, .NET, Go, Java, and generated-route systems.
- Add a Keploy-compatible replay importer/exporter around the built-in replay engine.
- Add AsyncAPI/Pact/message-contract adapter support.
- Add multi-provider benchmark scoring.
- Add npm publish workflow automation when release governance is ready.
