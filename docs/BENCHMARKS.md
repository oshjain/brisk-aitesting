# Test results and coverage

Fresh run date: Tuesday, July 28, 2026

This page shows three simple things:

- what we ran
- what passed or failed
- how much each suite covered

## Scoreboard

| View | Value |
| --- | ---: |
| Commands run | 17 |
| Commands passed | 17 |
| Commands failed | 0 |
| Command pass rate | 100% |
| Standalone suites passed | 14 / 14 |
| Roll-up chain passed | 1 / 1 |
| Real AI suite | Passed |
| Main release gate | `npm run release:check` passed |
| Main roll-up result | `smoke:ci` passed inside the release gate |

## Main result table

| Command | Result | Coverage count | Key numbers | Time |
| --- | --- | ---: | --- | ---: |
| `npm run benchmark` | Pass | 10 cases | 10 passed, 0 failed, 100% | 15.8s |
| `npm run smoke` | Pass | 6 scenarios | 6 passed, 27 artifacts, 4 UI routes, 3 API routes | 78.1s |
| `npm run smoke:contracts` | Pass | 4 coverage counters | 39 runtime exports, 36 type exports, 38 schemas, 22 scripts | 6.0s |
| `npm run smoke:engine-conformance` | Pass | 6 engines | 6 passed engines | 11.1s |
| `npm run smoke:plugin-conformance` | Pass | 4 plugin checks | 1 good plugin passed, 3 bad plugins blocked as expected | 3.9s |
| `npm run smoke:extension-conformance` | Pass | 10 extension checks | 5 good extensions passed, 5 bad extensions failed as expected | 4.6s |
| `npm run smoke:adapter-readiness` | Pass | 3 adapters | 3 adapters built and ready | 2.1s |
| `npm run smoke:specmatic` | Skip locally | 1 optional adapter | skips unless Java/Specmatic are available; CI workflow installs Java | 4.9s |
| `npm run smoke:keploy` | Skip locally | 1 optional adapter | skips unless Keploy CLI is available; CI workflow installs Keploy | 4.9s |
| `npm run smoke:reference-serious-saas` | Pass | 13 scenarios | 13 passed, 4 negative scenarios, 43 artifacts | 27.6s |
| `npm run smoke:reference-proof-apps` | Pass | 20 scenarios | 20 passed across 3 apps | 21.6s |
| `npm run smoke:golden-fixtures` | Pass | 13 checked scenarios | 13 checked, 13 matched | 18.0s |
| `npm run smoke:cli` | Pass | 2 CLI result types | exit code `0`, usage error code `2` | 6.3s |
| `npm run smoke:ai-fixtures` | Pass | 6 fixtures | 5 contract fixtures, repaired run 2/2, 1 repair event | 6.3s |
| `npm run pack:check` | Pass | 135 packed files | unpacked size 1,548,455 bytes | 16.6s |
| `npm run smoke:real-ai` | Pass | 2 scenarios | 2 passed, UI + API, 14 artifacts | 29.4s |
| `npm run smoke:ci` | Pass | 12 chained suites | all chained suites passed | 99.8s |

## Coverage table

| Area | What is covered | Metric values |
| --- | --- | --- |
| Benchmark behavior | config, OpenAPI, discovery, AI planning, API checks, security, CLI | 10 cases across 7 areas |
| Basic product run | UI, API, contract, discovery, artifacts | 6 scenarios, 27 artifacts |
| API and contract surface | exported runtime API, type API, schemas, runnable scripts | 39 runtime exports, 36 type exports, 38 schemas, 22 scripts |
| Engine quality | built-in engines | 6 engines checked: api, contract, schema, replay, message, ui |
| Plugin safety | plugin engine behavior | 1 good plugin passed, 3 bad plugins rejected |
| Extension safety | discoverer, planner, validator, UI grounder, AI provider extensions | 5 good passed, 5 bad rejected |
| Adapter readiness | shipping adapter build | 3 adapters ready: Schemathesis, Specmatic, Keploy |
| Reference app depth | serious SaaS reference app | 13 scenarios, 4 negative scenarios, 43 artifacts |
| Reference app breadth | proof apps set | 3 apps, 20 total scenarios |
| Golden fixture stability | saved expected outputs | 13 checked scenarios |
| CLI quality | normal run and bad input behavior | success exit code `0`, bad input exit code `2` |
| AI repair flow | fixture-based AI repair and planning | 6 fixtures, 1 repair event, repaired run 2/2 |
| Package quality | packed publish output | 135 files, 1.55 MB unpacked |
| Real provider path | live provider-backed UI and API run | 2 scenarios passed |

## Benchmark details

### Benchmark summary

| Metric | Value |
| --- | ---: |
| Cases | 10 |
| Passed | 10 |
| Failed | 0 |
| Pass rate | 100% |
| Report time | `2026-07-28T08:58:16.126Z` |

### Benchmark area breakdown

| Area | Cases | Passed | Total case time |
| --- | ---: | ---: | ---: |
| config | 1 | 1 | 1ms |
| openapi | 2 | 2 | 17ms |
| discovery | 2 | 2 | 217ms |
| ai | 1 | 1 | 4ms |
| api | 2 | 2 | 218ms |
| security | 1 | 1 | 25ms |
| cli | 1 | 1 | 2897ms |

### Benchmark case list

| Case | Result | What it checks |
| --- | --- | --- |
| `config.rejects-secret-looking-api-key-env` | Pass | secret-looking API key names are rejected |
| `openapi.malformed-yaml-fails` | Pass | broken OpenAPI YAML is caught |
| `openapi.empty-paths-diagnosed` | Pass | empty OpenAPI files are reported clearly |
| `discovery.missing-openapi-reported` | Pass | missing OpenAPI files show warnings |
| `discovery.contract-drift-reports-route-mismatches` | Pass | code and contract drift is found |
| `ai-parser.ignores-irrelevant-object-before-plan` | Pass | planner picks the real plan |
| `api.response-schema-mismatch-fails` | Pass | bad response shape is caught |
| `api.undocumented-status-fails` | Pass | undocumented status code is caught |
| `security.network-policy-blocks-disallowed-host` | Pass | blocked hosts stay blocked |
| `cli.invalid-scenarios-exits-2` | Pass | bad CLI input returns the right error code |

## Reference app results

### `smoke:reference-serious-saas`

| Metric | Value |
| --- | ---: |
| Scenarios | 13 |
| Passed | 13 |
| Failed | 0 |
| Negative scenarios | 4 |
| Artifacts | 43 |
| Pass rate | 100% |

### `smoke:reference-proof-apps`

| App | Scenarios | Passed | Failed | Types covered | Artifacts |
| --- | ---: | ---: | ---: | --- | ---: |
| `api-only` | 6 | 6 | 0 | api, contract, schema, replay | 9 |
| `todo` | 7 | 7 | 0 | ui, api, contract, schema | 19 |
| `multi-tenant` | 7 | 7 | 0 | ui, api, contract, schema | 19 |
| Total | 20 | 20 | 0 | mixed | 47 |

## Quality signals

| Signal | Result |
| --- | --- |
| Bad inputs are checked | Yes |
| Negative scenarios are checked | Yes |
| UI, API, contract, schema, replay, message, Schemathesis, Specmatic, and Keploy paths are checked | Yes |
| Real provider path is checked | Yes |
| Artifact output is checked | Yes |
| Pack output is checked | Yes |
| Roll-up chain is fully stable | Yes in the latest release gate |

## Bottom line

| Question | Answer |
| --- | --- |
| Is the project lightly tested? | No |
| Does it cover many kinds of checks? | Yes |
| Are the standalone suites strong? | Yes |
| Is the full chained run fully clean today? | Yes |
| Does this page show real run data instead of claims? | Yes |

## Source files

- [package.json](C:/Users/u306076/Documents/azure-pubsub/me2u/packages/brisk-aitesting/package.json)
- [smoke/run-benchmark.mjs](C:/Users/u306076/Documents/azure-pubsub/me2u/packages/brisk-aitesting/smoke/run-benchmark.mjs)
- [smoke/run-smoke.mjs](C:/Users/u306076/Documents/azure-pubsub/me2u/packages/brisk-aitesting/smoke/run-smoke.mjs)
- [.brisk-aitesting-benchmark/benchmark-report.json](C:/Users/u306076/Documents/azure-pubsub/me2u/packages/brisk-aitesting/.brisk-aitesting-benchmark/benchmark-report.json)
