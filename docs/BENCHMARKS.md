# Benchmark Results

This document captures the actual benchmark suite results for `brisk-aitesting` from a fresh run on Tuesday, July 28, 2026.

## What this benchmark means in this project

In this repository, `benchmark` is a scenario benchmark suite for product behavior, not a load, throughput, or latency stress benchmark. The suite verifies whether Brisk correctly detects and reports important quality, contract, security, AI-planning, and CLI conditions.

That means some benchmark cases intentionally provoke product-level failures such as schema mismatch or undocumented HTTP status. Those benchmark cases still pass when Brisk detects the problem correctly.

## Run metadata

| Field | Value |
| --- | --- |
| Command | `npm run benchmark` |
| Run date | Tuesday, July 28, 2026 |
| Report schema | `brisk-aitesting.benchmark.v1` |
| Report timestamp (UTC) | `2026-07-28T07:01:25.338Z` |
| Total cases | 10 |
| Passed | 10 |
| Failed | 0 |
| Pass rate | 100% |
| Total measured case runtime | 3,138 ms |
| Average case runtime | 313.8 ms |
| Median case runtime | 33 ms |
| Fastest case | `config.rejects-secret-looking-api-key-env` (1 ms) |
| Slowest case | `cli.invalid-scenarios-exits-2` (2,639 ms) |

## Executive summary

Brisk passed every benchmark case in the current suite.

The strongest signals from this run are:

- configuration safety checks reject secret-looking API key values immediately
- OpenAPI ingestion surfaces malformed and empty-contract conditions clearly
- discovery correctly identifies missing contracts and contract drift
- AI plan parsing ignores irrelevant earlier objects and locks onto the actual plan
- API execution correctly fails when schema or documented-status expectations are violated
- network policy enforcement blocks disallowed hosts safely without crashing
- CLI validation returns the expected non-zero exit code and error message for invalid input

The runtime profile is also healthy for this style of benchmark suite. Most checks complete in a few milliseconds to low hundreds of milliseconds. The total runtime is dominated by the CLI case, which is expected because it includes a full child-process launch.

## Coverage by benchmark area

| Area | Cases | Passed | Failed | Total duration |
| --- | ---: | ---: | ---: | ---: |
| config | 1 | 1 | 0 | 1 ms |
| openapi | 2 | 2 | 0 | 34 ms |
| discovery | 2 | 2 | 0 | 133 ms |
| ai | 1 | 1 | 0 | 3 ms |
| api | 2 | 2 | 0 | 294 ms |
| security | 1 | 1 | 0 | 34 ms |
| cli | 1 | 1 | 0 | 2,639 ms |

## Analytical view

### 1. Specification compliance

Brisk demonstrates strong specification-compliance behavior in this run:

- malformed OpenAPI is rejected with a parser error
- empty OpenAPI contracts are accepted as documents but diagnosed as having zero operations
- response schema mismatch is detected precisely
- undocumented response status is detected precisely

This is the most mature benchmark theme in the suite because it validates both contract ingestion and runtime contract enforcement.

### 2. Product experience

The product experience signal is good because the suite verifies not just failure detection, but useful failure reporting:

- missing contracts produce explicit discovery warnings
- invalid CLI scenario counts return exit code `2` with a direct actionable message
- blocked network calls are skipped safely with a clear diagnostic

These are the kinds of benchmark outcomes that reduce confusion for users during setup and debugging.

### 3. Operational analytics

The benchmark report already provides a useful operational summary:

- per-case status
- per-case duration
- per-area grouping
- overall pass rate

Current limitation: the benchmark output is excellent for point-in-time reporting, but not yet trend-oriented. There is no built-in historical comparison across runs inside the benchmark report itself.

### 4. Security posture

The suite includes a meaningful security control benchmark:

- disallowed outbound hosts are blocked by policy
- the engine skips execution safely instead of failing unpredictably

This is a strong baseline signal for default-safe runtime behavior.

### 5. Developer workflow

From a developer workflow perspective, the suite is compact and practical:

- full benchmark suite completed in about 3.1 seconds of measured case time
- only one case materially dominates runtime, and that is the CLI process-launch path
- benchmark output is machine-readable JSON and straightforward to convert into release evidence

## Detailed benchmark matrix

| # | Case ID | Area | Benchmark pass/fail | Duration | What was checked | Observed result |
| ---: | --- | --- | --- | ---: | --- | --- |
| 1 | `config.rejects-secret-looking-api-key-env` | config | Pass | 1 ms | `normalizeConfig` rejects `apiKeyEnv` values that look like secrets | Secret-looking value was rejected |
| 2 | `openapi.malformed-yaml-fails` | openapi | Pass | 32 ms | malformed YAML OpenAPI throws a parser error | Parser error was raised |
| 3 | `openapi.empty-paths-diagnosed` | openapi | Pass | 2 ms | empty OpenAPI emits diagnostics and zero operations | 0 operations and diagnostic emitted |
| 4 | `discovery.missing-openapi-reported` | discovery | Pass | 14 ms | missing OpenAPI contract is surfaced in discovery warnings | Missing contract warning emitted |
| 5 | `discovery.contract-drift-reports-route-mismatches` | discovery | Pass | 119 ms | implemented-but-undocumented and documented-but-not-implemented routes are detected | Drift report correctly identified both mismatch classes |
| 6 | `ai-parser.ignores-irrelevant-object-before-plan` | ai | Pass | 3 ms | parser ignores irrelevant object and selects the real plan | Correct target path `/api/wrong-schema` selected |
| 7 | `api.response-schema-mismatch-fails` | api | Pass | 185 ms | engine fails when response body violates schema | Runtime scenario failed correctly on `/ok must be boolean` |
| 8 | `api.undocumented-status-fails` | api | Pass | 109 ms | engine fails when response status is undocumented | Runtime scenario failed correctly on documented `200` vs actual `418` |
| 9 | `security.network-policy-blocks-disallowed-host` | security | Pass | 34 ms | network policy blocks disallowed host safely | Scenario was skipped correctly with blocked-host diagnostic |
| 10 | `cli.invalid-scenarios-exits-2` | cli | Pass | 2,639 ms | invalid `--scenarios` exits with code `2` and clear message | CLI returned code `2` with expected validation message |

## Benchmark interpretation notes

Two cases deserve special explanation because the observed runtime scenario status is intentionally negative while the benchmark itself is a pass:

- `api.response-schema-mismatch-fails`: the engine is supposed to fail the scenario because the response body violates the OpenAPI schema
- `api.undocumented-status-fails`: the engine is supposed to fail the scenario because the endpoint returns an undocumented `418` status

Those are benchmark passes because they prove Brisk catches the defect instead of silently accepting it.

## Current gaps

### Built

- benchmark suite execution command
- machine-readable benchmark JSON report
- coverage across config, OpenAPI, discovery, AI parsing, API enforcement, security, and CLI behavior
- 100% pass result for the latest run

### Partially built

- analytical reporting now exists in documentation, but historical trend reporting is still manual

### Missing

- historical benchmark trend table across releases
- benchmark visualization inside the docs site
- dedicated performance/load benchmark data if the product later wants true throughput or latency benchmarking

### Blocked by product decision

- whether future benchmark docs should remain behavior-oriented only, or expand to include stress/performance benchmarking

### Blocked by external dependency

- none for the current benchmark suite

## Source of truth

The authoritative benchmark output for this run is the generated report:

- [.brisk-aitesting-benchmark/benchmark-report.json](C:/Users/u306076/Documents/azure-pubsub/me2u/packages/brisk-aitesting/.brisk-aitesting-benchmark/benchmark-report.json)

The benchmark runner that defines the suite is:

- [smoke/run-benchmark.mjs](C:/Users/u306076/Documents/azure-pubsub/me2u/packages/brisk-aitesting/smoke/run-benchmark.mjs)
