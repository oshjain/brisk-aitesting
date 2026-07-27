# brisk-aitesting Status

This package is an alpha release. It already runs real checks, but we are still building toward the larger vision.

The rule is simple: AI can suggest what to test, but Brisk checks the plan before anything runs. Engines do the execution. Evidence records what happened.

## Built

- Provider-agnostic AI planner adapter.
- Validation and repair loop for AI-generated plans.
- CLI run workflow with stable exit codes and `brisk-aitesting.cli-result.v1`.
- SDK entry point with stable result and handover objects.
- OpenAPI JSON/YAML parsing.
- OpenAPI route discovery, schema extraction, generated API scenarios, and response schema validation.
- Playwright UI execution with grounded locator evidence.
- UI route grounding feedback loop.
- API, OpenAPI, Playwright, UI grounding, UI action, result, handover, CLI, and benchmark schemas.
- Deterministic CI gate.
- Manual real AI smoke workflow.
- Adversarial benchmark report: `brisk-aitesting.benchmark.v1`.
- Release pack check: `brisk-aitesting.pack-check.v1`.
- Engine conformance report: `brisk-aitesting.engine-conformance.v1`.
- Engine plugin conformance API and smoke report: `brisk-aitesting.plugin-conformance.v1`.
- Serious SaaS reference app report: `brisk-aitesting.reference-serious-saas.v1`.
- Golden fixture report: `brisk-aitesting.golden-fixtures.v1`.
- npm package publication path.

## Partly Built

- UI workflow generation is grounded and executable, but complex multi-page journeys still need broader benchmark coverage.
- OpenAPI scenario generation handles common request/response schemas, but deeper OpenAPI and JSON Schema coverage will keep expanding.
- Analytics exist as structured summaries and benchmark reports, but richer trend analytics are future work.
- Business-intent scenarios can be expressed in goals/objectives/assertions, but reusable rule IDs, rule coverage, and contradiction checks are future work.
- Scenario routing already understands `schema`, `replay`, and `custom` types, but schema fuzz and replay engines still need real built-in adapters.

## Not Built Yet

- AI does not execute code.
- AI-generated Playwright code is not accepted.
- AI-generated selectors are not trusted.
- Real provider quality is not benchmark-scored across models yet.
- Built-in Schemathesis, Specmatic, Keploy, AsyncAPI, Pact, or message-contract adapters.
- Built-in schema fuzz engine.
- Built-in replay engine.
- Full reference app matrix beyond serious-saas.
- Conformance suites for non-engine extension points: discoverers, planners, validators, UI grounders, and AI providers.
- Formal UI selector healing stage with before/after evidence diffing.

## Next Work

- Add reference apps: Todo, Auth SaaS, E-commerce, API-only, Multi-tenant SaaS, Event/messaging.
- Add golden fixtures for stable plan/result comparison.
- Extend conformance beyond engines to discoverers, planners, validators, UI grounders, and AI providers.
- Add schema fuzz engine for OpenAPI/JSON Schema negative coverage.
- Add a replay adapter shape and then a Keploy-compatible implementation.
- Add AsyncAPI/Pact/message-contract adapter support.
- Add JUnit/HTML reporter support.
- Add multi-provider benchmark scoring.
- Add release notes and npm release automation.
