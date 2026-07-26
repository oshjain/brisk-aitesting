# brisk-aitesting Status

This package is in pre-public-alpha readiness. The foundation is intentionally strict: AI plans, but engines execute; schemas define handover; CI and benchmarks guard regressions.

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

## Partially Built

- UI workflow generation is grounded and executable, but complex multi-page journey planning still needs broader benchmark coverage.
- OpenAPI scenario generation handles common request/response schemas, but full OpenAPI and JSON Schema coverage will keep expanding.
- Analytics exist as structured summaries and benchmark reports, but richer trend analytics are future work.

## Not Promised Yet

- AI does not execute code.
- AI-generated Playwright code is not accepted.
- AI-generated selectors are not trusted.
- Real provider quality is not benchmark-scored across models yet.
- npm public release is not published from this repo yet.

## Next After This Gate

- Framework-specific examples for Express, Fastify, Next.js, and hosted SaaS integrations.
- JUnit/HTML reporter support.
- Multi-provider benchmark scoring.
- Public alpha release checklist and npm publishing workflow.
