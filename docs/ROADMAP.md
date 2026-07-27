# brisk-aitesting Roadmap

This roadmap exists to keep the product honest. Built-in capability, extension capability, and future work must not be mixed.

## Product Thesis

`brisk-aitesting` is an embeddable AI testing control plane:

```text
discovery -> structured planning -> deterministic validation -> specialised engines -> unified evidence
```

The strongest product idea is not "AI writes Playwright tests." The stronger idea is that host teams can embed a local SDK/CLI that turns app context and business goals into validated multi-engine test plans and portable evidence.

## Precision Rules

- AI output is never directly executed.
- AI returns structured plan JSON.
- Every plan is normalized and validated before execution.
- Engines generate executable artifacts.
- UI actions use observed evidence IDs, not invented selectors.
- Results always follow versioned handover contracts.
- Host apps own storage, dashboards, CI, and observability.
- Custom engines must pass conformance checks before they are treated as product-safe.

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
- UI grounding and evidence-ID action execution.
- Versioned result and handover JSON.
- Event stream callbacks.
- Artifact collection.
- Deterministic smoke, benchmark, pack, and real-AI gates.

## Product Gaps

- No built-in schema fuzz engine yet.
- No built-in replay engine yet.
- No built-in Schemathesis or Specmatic adapter yet.
- No built-in Keploy adapter yet.
- No built-in AsyncAPI, Pact, or message-contract engine yet.
- No reference app matrix yet.
- No plugin conformance suite yet.
- No formal UI healing stage with before/after evidence diffing yet.
- No JUnit/HTML reporters yet.
- No semantic rule registry yet.

## How We Make It Whole

### 1. Reference Apps

Create real sample applications that every product change must pass:

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

### 2. Golden Fixtures

For stable inputs, store expected plans and result envelopes.

When a plan changes, the suite should report:

- scenarios added
- scenarios removed
- assertion strength changed
- engine routing changed
- expected status/body/schema changed

This catches silent degradation after AI repair or planner changes.

### 3. Plugin Conformance Suite

Every engine/plugin must prove:

- it declares which scenario types it can run
- it rejects unsupported scenarios
- it produces `ScenarioResult`
- it emits artifacts consistently
- it respects runtime timeout/retry/security config
- it never leaks secrets
- it maps failures into diagnostics

### 4. Schema Fuzz Engine

Add a built-in engine that creates schema-aware negative cases from OpenAPI/JSON Schema:

- missing required fields
- invalid enum values
- wrong primitive types
- boundary values
- additional properties
- malformed payloads

The first implementation should use the existing AJV/schema utilities before adding external fuzzing libraries.

### 5. Replay Engine

Add a replay engine boundary first, then a Keploy-compatible adapter:

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

Formalize UI healing as a stage:

```text
failed locator -> fresh grounding -> candidate replacement -> validation -> retry -> evidence diff
```

Healing must never silently hide failure. It should report what changed and why the retry was allowed.

### 8. Business Intent And Rule Governance

Stage 1: scenario carries the business rule.

```text
Given X, when Y, expect Z.
```

Stage 2: AI proposes candidate scenarios from source, docs, existing tests, and copy.

Stage 3: host teams approve reusable rule IDs.

Stage 4: Brisk reports rule coverage and apparent contradictions when rules/scenarios are structured enough to compare.

The product should not claim it can know every critical rule unless the host supplies criteria.

## Early High-Value Use Cases

- OpenAPI regression generation.
- Pull-request smoke testing.
- Internal SaaS testing feature.
- AI-generated application verification.
- Domain-specific testing control planes.
- Unified test evidence for analytics.

## Release Quality Gate Target

Before calling the product production-ready, require:

- reference app matrix passing on Windows and Linux
- plugin conformance suite passing
- golden fixture diffs reviewed
- real provider smoke passing
- npm pack check passing
- security boundary tests passing
- failure recovery tests passing
- release notes generated
