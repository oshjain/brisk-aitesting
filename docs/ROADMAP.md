# brisk-aitesting Roadmap

This roadmap keeps us honest. It separates what works today, what is partly there, and what we still need to build.

## What We Are Building

`brisk-aitesting` is a local AI testing layer that teams can embed into their own products:

```text
discovery -> structured planning -> deterministic validation -> specialised engines -> unified evidence
```

The point is not "AI writes Playwright tests." The point is better than that:

Teams should be able to give Brisk a testing goal, let it inspect the app, get a checked test plan, run the right engines, and receive clean evidence they can use in their own dashboard, CI, or database.

## Rules That Keep It Reliable

- AI output is never directly executed.
- AI returns structured plan JSON.
- Every plan is normalized and validated before execution.
- Engines generate or run the executable work.
- UI actions use observed evidence IDs, not invented selectors.
- Results always follow versioned handover contracts.
- Host apps own storage, dashboards, CI, and observability.
- Custom engines must pass quality checks before we trust them in normal runs.

## Built Today

- Core SDK and CLI.
- Provider-agnostic AI planner adapter.
- Deterministic fallback planner.
- Plan normalization, validation, and repair.
- Repo, UI route, API route, and OpenAPI discovery.
- OpenAPI JSON/YAML parsing.
- Positive and negative API scenario generation from common OpenAPI schemas.
- Runtime API response validation with AJV.
- Built-in Playwright UI engine.
- Built-in API engine.
- Built-in OpenAPI contract engine.
- External engine quality API and automated health gate.
- Optional Schemathesis OpenAPI deep API checker with readiness manifest and coverage gate.
- UI grounding and evidence-ID action execution.
- Versioned result and handover JSON.
- Event stream callbacks.
- Artifact collection.
- Deterministic release, bad-input, package, and real-AI gates.
- Adapter readiness gate for built adapters.

## Gaps

- No built-in schema fuzz engine yet.
- No built-in replay engine yet.
- No built-in Specmatic adapter yet.
- No built-in Keploy adapter yet.
- No built-in AsyncAPI, Pact, or message-contract engine yet.
- No full proof app collection yet.
- No quality-check suite yet for non-engine extension points: discoverers, planners, validators, UI grounders, and AI providers.
- No formal UI healing stage with before/after evidence diffing yet.
- No JUnit/HTML reporters yet.
- No shared business rule catalog yet.

## How We Finish It Properly

### 1. Proof Apps

Create real sample applications that every product change must pass. Think of these as proving grounds: if Brisk works here, users can trust that it handles real product shapes, not only small demos.

- Todo app
- Auth SaaS app
- E-commerce app
- API-only app
- Multi-tenant SaaS app
- Event/messaging app

Each app should provide:

- source routes
- UI routes
- OpenAPI/AsyncAPI/Pact contracts where relevant
- seed data
- safe test users
- expected result fixtures

### 2. Golden Expected Outputs

For stable inputs, store expected plans and result summaries. In simple words: keep a known-good answer, then compare future answers against it.

When a plan changes, the suite should report:

- scenarios added
- scenarios removed
- assertion strength changed
- engine routing changed
- expected status/body/schema changed

This catches quiet degradation after AI repair or planner changes.

### 3. Extension Quality Checks

Engine quality checks are built for the `Engine` interface. The remaining work is to apply the same discipline to the other extension points.

Every engine plugin must prove:

- it declares which scenario types it can run
- it rejects unsupported scenarios
- it produces `ScenarioResult`
- it emits artifacts consistently
- it respects runtime timeout/retry/security config
- it never leaks secrets
- it maps failures into diagnostics

Every adapter marked as built must also appear in `adapters/manifest.json` and pass the adapter readiness gate. That means automation checks the shipping basics: code exists, exports exist, docs mention it, the npm package includes it, CI can run it, proof-app coverage exists, quality checks pass, evidence is saved, and minimum coverage is met.

Future non-engine quality checks should define the stable output contract for each extension type.

### 4. Schema Fuzz Engine

Schemathesis now provides optional real OpenAPI fuzzing through its CLI. The remaining product work is a lighter JS-native engine that creates schema-aware negative cases from OpenAPI/JSON Schema:

- missing required fields
- invalid enum values
- wrong primitive types
- boundary values
- additional properties
- malformed payloads

The first implementation should use the existing AJV/schema utilities before adding external fuzzing libraries.

### 5. Replay Engine

Add the replay engine shape first, then a Keploy-compatible adapter:

- captured request input
- expected response or invariant
- replay target
- diff artifact
- pass/fail mapping

### 6. Message And Contract Engines

Add adapters in this order:

- AsyncAPI summary parser
- message contract scenario type
- Pact adapter
- Specmatic adapter

These should remain optional dependencies or separate packages if they add heavy runtime requirements.

### 7. UI Healing

Build UI healing as a visible stage:

```text
failed locator -> fresh grounding -> candidate replacement -> validation -> retry -> evidence diff
```

Healing must never silently hide failure. It should report what changed and why a retry was allowed.

### 8. Business Intent And Rule Governance

Stage 1: scenario carries the business rule.

```text
Given X, when Y, expect Z.
```

Stage 2: AI proposes candidate scenarios from source, docs, existing tests, and copy.

Stage 3: host teams approve reusable rule IDs.

Stage 4: Brisk reports rule coverage and apparent contradictions when rules/scenarios are structured enough to compare.

The product should not claim it can know every critical rule unless the host supplies criteria.

## Early Useful Use Cases

- OpenAPI regression generation.
- Pull-request health checks.
- Internal SaaS testing feature.
- AI-generated application verification.
- Domain-specific testing layers.
- Unified test evidence for analytics.

## Release Quality Target

Before calling the product production-ready, require:

- proof app collection passing on Windows and Linux
- plugin quality suite passing
- golden expected-output diffs reviewed
- real provider check passing
- npm pack check passing
- security tests passing
- failure recovery tests passing
- release notes generated
