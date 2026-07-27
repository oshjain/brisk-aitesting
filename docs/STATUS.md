# brisk-aitesting Status

This package is an alpha release. The foundation is intentionally strict: AI plans, validators constrain, engines execute, evidence records, and schemas define handover.

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

## Partially Built

- UI workflow generation is grounded and executable, but complex multi-page journey planning still needs broader benchmark coverage.
- OpenAPI scenario generation handles common request/response schemas, but full OpenAPI and JSON Schema coverage will keep expanding.
- Analytics exist as structured summaries and benchmark reports, but richer trend analytics are future work.
- Business-intent scenarios can be expressed in goals/objectives/assertions, but reusable rule IDs, rule coverage, and contradiction analysis are future governance layers.
- Scenario routing supports `schema`, `replay`, and `custom` types structurally, but schema fuzz and replay engines are extension points until built-in adapters are added.

## Not Built In Yet

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

## Next Product Completeness Work

- Add reference apps: Todo, Auth SaaS, E-commerce, API-only, Multi-tenant SaaS, Event/messaging.
- Add golden fixtures for stable plan/result comparison.
- Extend conformance beyond engines to discoverers, planners, validators, UI grounders, and AI providers.
- Add schema fuzz engine for OpenAPI/JSON Schema negative coverage.
- Add replay adapter boundary and then Keploy-compatible implementation.
- Add AsyncAPI/Pact/message-contract adapter boundary.
- Add JUnit/HTML reporter support.
- Add multi-provider benchmark scoring.
- Add release notes and npm release automation.
