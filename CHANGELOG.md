# Changelog

All notable changes to `brisk-aitesting` are recorded here.

## 0.2.0

- Added a pinned Directus 12.2.0, Medusa 2.18.0/PostgreSQL 16, and n8n 2.32.7 real-system lab with isolated readiness, secret, source-integrity, reset-safety, and helper-owned Medusa process proof. The dated proof log records 66/66 current checks plus the exact defects and limits; the change-gate guide makes all three architectures the minimum default for future product-behavior upgrades without presenting readiness as business-scenario support.
- Added a reproducible target-depth inventory and honest coverage-gap guide. The pinned sources contain 54,025 tracked files, 441 statically counted UI route records, and at least 1,261 statically counted HTTP handlers, while current executed business UI scenarios on Directus, Medusa, and n8n remain 0; the guide defines a meaningful 67-check-per-application minimum rather than treating route discovery or shallow visibility checks as behavior proof.
- Replaced the default AI-to-executable-plan path with a non-executable intent boundary (`brisk-aitesting.intent.v1`), authoritative evidence graph, protocol-neutral semantic compiler, workflow IR, and adapter lowering.
- Added deterministic typed input binding, dependency construction, ambiguity detection, mutation authority, outcome selection, capture derivation, and automatic cleanup synthesis.
- Made automatic cleanup follow reverse resource dependencies instead of one global reverse list, kept independent branches independent, and created distinct cleanup steps for multiple resources produced by the same operation.
- Added a shared pre-lowering validation gate that blocks stale, altered, or de-authorized cleanup workflows before any adapter receives them and returns structured `WORKFLOW_VALIDATION_FAILED` diagnostics.
- Added real OpenAPI and typed host HTTP capability adapters, using Swagger Parser and OpenAPI Sampler rather than a new hand-written OpenAPI parser.
- Added real semantic workflow proof for a five-operation channel/topic/subscription/message lifecycle reported as one logical test, plus executed compensation cleanup that leaves no resource behind.
- Added protocol-neutral compiler fixtures for REST, GraphQL, messaging, browser accessibility, and proprietary capabilities. Only OpenAPI and typed host HTTP currently have production evidence/lowering adapters.
- Separated operational run completion (`outcome`) from application test verdicts. Accepted tests now finish as `passed` or `failed`; invalid plans complete with diagnostics and no fabricated test.
- Added an append-only per-run journal, interrupted-run recovery on the next invocation, stage and engine timeouts, observer isolation, engine exception containment, and best-effort completion when reporting or persistence fails.
- Added atomic final result writing. The returned result and successfully persisted `result.json` now describe the same finalized artifact set.
- Moved cleanup out of the test summary, registered mutation compensation before requests execute, continued cleanup after individual cleanup errors, and exposed cleanup under `operations`.
- Added an authoritative mutation gate. Successful mutations require an OpenAPI-backed operation or a typed host/runtime operation adapter; required fields and declared success statuses are checked before execution.
- Added actual JSON Schema structured-output requests for compatible AI providers while retaining deterministic SDK validation as the authority.
- Added result-level plan redaction and structured diagnostic redaction.
- Added an adversarial reliability smoke covering engine exceptions, broken observers, discovery failure, invalid input, journaling, redaction, and saved/returned result identity.
- Removed forced CLI process termination. This fixed the reproduced Windows `UV_HANDLE_CLOSING` crash that could occur after an otherwise successful command with pending HTTP runtime cleanup.
- Removed invented default routes from discovery, added explicit route seeds, raised the configurable source inventory limit from a silent 500-file cutoff to 20,000, and report truncation instead of silently presenting an incomplete large-repository view.

This release establishes the control-plane contract but does not claim literal availability under machine loss or permanently unavailable storage. Broader external-adapter chaos coverage remains in progress.

## 0.1.10

- Added `scenarioCountPolicy` to run input so hosts can make scenario count an exact validation contract instead of a loose planning hint.
- Added validation that rejects too few or too many scenarios when `scenarioCountPolicy` is `exact`.
- Passed exact scenario count rules into AI planning and repair prompts so repaired plans must preserve the requested count.
- Added benchmark coverage for exact scenario count pass, too-low, and too-high cases.

## 0.1.9

- Fixed AI plan normalization so model output can no longer self-certify targets with `sourceOfTruth: "user"`; user provenance is now reserved for host-supplied targets only.
- Updated AI planner prompts to require `observed`, `contract`, or `ai` target provenance and explicitly forbid AI-generated `user` provenance.
- Matched dynamic workflow paths such as `/api/topics/<topicId>/messages` against discovered route patterns such as `/api/topics/:topicId/messages`, while still rejecting wrong routes such as `/api/topics/<topicId>/publish`.
- Added smoke and benchmark coverage for AI-declared user provenance, invented routes, dynamic route proof, and wrong dynamic route suffix rejection.

## 0.1.8

- Added a proven-plan execution gate so AI cannot mark routes as user-supplied unless the host explicitly provides those targets.
- Added dependency blocking: scenarios that need a failed earlier scenario or missing captured value are marked `blocked` instead of running with misleading 404/400 failures.
- Validated scenario dependency order so a test can only depend on earlier scenarios in the same plan.
- Preserved `blocked` in result, diagnosis, JUnit, and HTML reporting contracts.
- Changed config-discovered targets from `user` to `observed`, so host config does not weaken execution proof.
- Added `planning.repairAttempts` so host products can control validation repair without pretending the SDK owns their AI provider/model config.
- Added smoke coverage for fake user provenance, explicit host targets, failed producers, and blocked dependent scenarios.
- Fixed the benchmark CLI success case to use a real OpenAPI-backed route and keep the benchmark honest.
- Added benchmark coverage for host-controlled planning repair configuration.

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
