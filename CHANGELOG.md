# Changelog

All notable changes to `brisk-aitesting` are recorded here.

## 0.1.7

- Blocked AI-derived executable targets by default in strict mode unless the host explicitly opts in.
- Added validation that observed and contract API/UI targets must match discovered routes, including templated contract routes such as `/api/items/{id}`.
- Added full workflow-variable validation before execution so request bodies, query values, headers, expectations, paths, and cleanup steps cannot use uncaptured variables.
- Added built-in workflow values for `<unique>`, `<uuid>`, `<timestamp>`, and `<now>`.
- Changed heuristic workflow capture to opt-in; explicit captures are now the default path.
- Added `brisk-aitesting inspect --result <path>` for readable and JSON inspection of failures, captures, cleanup actions, artifact roots, and UI healing evidence.
- Deepened `doctor` checks for app reachability, OpenAPI parsing, auth page reachability, Playwright browser launch, Java runtime, and optional Specmatic runtime presence.
- Simplified `init` output to a small starter config while keeping strict defaults inside the SDK.
- Improved failure diagnosis for workflow variables, AI-only targets, auth failures, missing routes/resources, request payload mismatches, and UI locator problems.
- Added smoke coverage for AI-only target blocking, unbound workflow variables in request bodies, CLI inspect output, strict route provenance, and discovered-route matching.

## 0.1.6

- Added strict target provenance so executable targets must say whether they are user-supplied, observed, contract-derived, AI-inferred, or fallback/default.
- Blocked fallback/default targets in strict mode unless the host explicitly allows them.
- Added explicit API workflow captures, capture provenance, and cleanup steps in the public plan contract.
- Added cleanup execution after the main scenario run.
- Hardened API artifact redaction for response headers, response bodies, primitive strings, bearer tokens, API-key-shaped strings, emails, and SSNs.
- Made UI healing policy-driven, with safe healing by default and fail-closed behavior for destructive-looking clicks.
- Changed `init` to create a runnable `.mjs` config, added `init --base-url`, and added `doctor`.
- Added JSON/YAML config loading for simpler non-TypeScript setup.
- Added public result and handover JSON schema exports and validation helpers.
- Strengthened smoke coverage for strict AI JSON, explicit workflow captures, secret redaction, and the generated `init -> doctor -> run` path.

## 0.1.5

- Tightened the AI plan gate so successful POST/PUT/PATCH API scenarios must include a request body before execution.
- Rejected low-value generated scenario names such as UUID-only or `ai-e2e-*` names so weak plans must be repaired instead of shown as meaningful tests.
- Corrected `custom` scenarios into API or UI scenarios when the target clearly points to an API path or UI route.
- Added AI fixture coverage for missing mutation bodies, generated names, and `custom` target correction.

## 0.1.4

- Added shared workflow state for engines so API scenarios can carry created IDs into later scenarios.
- Added generic placeholder resolution for API paths and request data, including `<resourceId>`, `:resourceId`, `{resourceId}`, and `<uuid>`.
- Added clear unresolved-variable failures before request execution instead of letting placeholder URLs fail later with misleading 404/400 responses.
- Tightened Playwright UI action execution so fill/select/check/click actions must target compatible page evidence.
- Added engine conformance coverage for a real multi-step API workflow that creates a parent resource and uses its captured ID in the next request.

## 0.1.3

- Fixed npm install weight for host applications by moving heavy adapter runtimes out of install-time dependencies.
- Kept Specmatic and Pact available for `brisk-aitesting` development and adapter validation without forcing every consuming app to download them.
- Clarified npm and pnpm-monorepo installation guidance for backend/runtime packages.

## 0.1.2

- Removed an unsupported replay-service adapter claim from the shipped stack.
- Added Pact message verification, live message-flow evidence, e-commerce proof app, and event/messaging proof app coverage.
- Expanded the benchmark suite to 57 meaningful checks across configuration, OpenAPI, schema generation, AI response handling, plan validation, API execution, replay, security, and CLI behavior.
- Added practical examples for SDK, CLI, OpenAPI API testing, grounded UI flows, schema checks, HTTP replay, message testing, Pact, Schemathesis, Specmatic, custom engines, custom AI providers, and GitHub Actions.
- Tightened package safety checks so examples and proof apps must ship in the npm tarball.
- Updated documentation status, compatibility notes, and benchmark reporting to match the built product.

## 0.1.1

- Added the local SDK and CLI foundation.
- Added structured AI planning, plan validation, repair, and safe execution boundaries.
- Added built-in Playwright, API, OpenAPI contract, schema fuzz, and replay engines.
- Added OpenAPI JSON/YAML discovery, route discovery for supported JavaScript/TypeScript patterns, and contract drift reporting.
- Added stable result/handover JSON, JUnit reports, HTML reports, and cleanup lifecycle output.
- Added engine/plugin quality gates, adapter readiness checks, serious SaaS proof app, golden fixtures, benchmark checks, and release package safety checks.
- Added optional Schemathesis OpenAPI deep API checker.
