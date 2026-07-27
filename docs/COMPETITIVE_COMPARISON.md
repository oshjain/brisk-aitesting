# Competitive Comparison

`brisk-aitesting` is compared here with the exact peer set that matters for AI-led software testing:

<table>
  <tr>
    <td align="center"><strong>mabl</strong></td>
    <td align="center"><strong>Katalon</strong></td>
    <td align="center"><strong>Tricentis Tosca</strong></td>
    <td align="center"><strong>testRigor</strong></td>
    <td align="center"><strong>Functionize</strong></td>
  </tr>
</table>

These are not random names. They represent the market buyers already understand: AI testing, low-code/no-code testing, enterprise automation, API testing, self-healing UI testing, and test orchestration.

This page separates three things that should never be mixed:

| View | What it means |
|:-----|:--------------|
| &#128188; Commercial strength | How established the company is: age, customers, revenue signal, market trust |
| &#9881; Product capability | What the product publicly offers: UI, API, AI, evidence, orchestration, integrations |
| &#128202; Benchmark proof | What can be proven in a repeatable test suite, not just a vendor website |

## Market Snapshot

Revenue for private companies is usually estimated. Where estimates vary, this page says so instead of pretending there is one perfect number.

<table>
  <tr>
    <th>Product</th>
    <th>Since</th>
    <th>Customer base signal</th>
    <th>Revenue signal</th>
    <th>Best-known angle</th>
  </tr>
  <tr>
    <td><strong>mabl</strong></td>
    <td>Founded 2017</td>
    <td>Public customer stories across SaaS, media, retail, and enterprise software</td>
    <td>Private company estimate; Growjo lists about $34.5M annual revenue</td>
    <td>AI-native, low-code end-to-end testing with self-healing and coverage intelligence</td>
  </tr>
  <tr>
    <td><strong>Katalon</strong></td>
    <td>Founded 2016</td>
    <td>Katalon says it serves more than 30,000 teams globally</td>
    <td>Private company estimate; Growjo lists about $62.2M annual revenue</td>
    <td>Broad test automation platform for web, API, mobile, desktop, and AI-assisted quality</td>
  </tr>
  <tr>
    <td><strong>Tricentis Tosca</strong></td>
    <td>Tricentis founded 2007</td>
    <td>Tricentis says it has more than 3,000 customers</td>
    <td>Tricentis reported ARR above $400M for 2024 and later announced ARR above $500M</td>
    <td>Enterprise model-based test automation, SAP testing, risk-based testing, and governance</td>
  </tr>
  <tr>
    <td><strong>testRigor</strong></td>
    <td>Founded 2015</td>
    <td>Public customer stories include enterprise and digital product teams</td>
    <td>Private company estimate; GetLatka lists about $15M ARR</td>
    <td>Plain-English test automation for web, mobile, API, email, SMS, and files</td>
  </tr>
  <tr>
    <td><strong>Functionize</strong></td>
    <td>Founded 2014</td>
    <td>Public positioning targets enterprise and large digital teams</td>
    <td>Private company estimate; Growjo lists about $38.6M annual revenue</td>
    <td>AI testing agents for authoring, execution, diagnosis, maintenance, and API/data checks</td>
  </tr>
</table>

## How To Read The Capability Map

The labels below are intentionally strict:

| Label | Meaning |
|:------|:--------|
| &#9989; Native | Available as a clear built-in/public product capability |
| &#128295; Extensible | Possible through documented SDK, API, plugin, integration, or custom setup |
| &#10060; Unsupported / not public | Not found as a clear public capability in cited sources |

This is a public-evidence comparison, not a private lab benchmark. A true benchmark must run every product against the same app, repo, scenario list, API contract, time limit, evaluator, and pass/fail rules.

## Capability Map

<table>
  <tr>
    <th>Capability</th>
    <th>Brisk</th>
    <th>mabl</th>
    <th>Katalon</th>
    <th>Tricentis Tosca</th>
    <th>testRigor</th>
    <th>Functionize</th>
  </tr>
  <tr>
    <td><strong>Human-language goal to test plan</strong><br />Can a user describe what to test without hand-coding every step?</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#128295; Extensible</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
  </tr>
  <tr>
    <td><strong>UI testing</strong><br />Browser workflows, selectors, screenshots, traces, and dynamic pages.</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
  </tr>
  <tr>
    <td><strong>API testing</strong><br />HTTP methods, headers, request bodies, response checks, and status validation.</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
  </tr>
  <tr>
    <td><strong>OpenAPI / contract validation</strong><br />Parse contracts, generate positive and negative checks, and catch response drift.</td>
    <td>&#9989; Native</td>
    <td>&#128295; Extensible</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#128295; Extensible</td>
    <td>&#9989; Native</td>
  </tr>
  <tr>
    <td><strong>Repository and route discovery</strong><br />Inspect source code before planning tests.</td>
    <td>&#9989; Native</td>
    <td>&#10060; Not public</td>
    <td>&#10060; Not public</td>
    <td>&#10060; Not public</td>
    <td>&#10060; Not public</td>
    <td>&#10060; Not public</td>
  </tr>
  <tr>
    <td><strong>AI safety boundary</strong><br />AI produces a structured plan; validation blocks malformed, unsafe, or unsupported actions.</td>
    <td>&#9989; Native</td>
    <td>&#128295; Not enough public detail</td>
    <td>&#128295; Not enough public detail</td>
    <td>&#128295; Not enough public detail</td>
    <td>&#128295; Not enough public detail</td>
    <td>&#128295; Not enough public detail</td>
  </tr>
  <tr>
    <td><strong>Multi-engine orchestration</strong><br />One run can route UI, API, contract, and adapter scenarios to the right engine.</td>
    <td>&#9989; Native</td>
    <td>&#128295; Extensible</td>
    <td>&#9989; Native</td>
    <td>&#9989; Native</td>
    <td>&#128295; Extensible</td>
    <td>&#9989; Native</td>
  </tr>
  <tr>
    <td><strong>Embeddable SDK / host-owned UI</strong><br />A product team can embed the testing engine and build its own UI, DB, permissions, and reporting.</td>
    <td>&#9989; Native</td>
    <td>&#10060; Not public</td>
    <td>&#128295; Extensible</td>
    <td>&#128295; Extensible</td>
    <td>&#10060; Not public</td>
    <td>&#128295; Extensible</td>
  </tr>
  <tr>
    <td><strong>Stable result handover contract</strong><br />A versioned JSON result object that another product can store, show, compare, or send to CI.</td>
    <td>&#9989; Native</td>
    <td>&#128295; Export/integration</td>
    <td>&#128295; Export/integration</td>
    <td>&#128295; Export/integration</td>
    <td>&#128295; Export/integration</td>
    <td>&#128295; Export/integration</td>
  </tr>
  <tr>
    <td><strong>Local-first / no hosted dashboard required</strong><br />Can testing run as a local SDK or CLI without forcing a proprietary cloud dashboard?</td>
    <td>&#9989; Native</td>
    <td>&#10060; Not public</td>
    <td>&#128295; Extensible</td>
    <td>&#128295; Extensible</td>
    <td>&#10060; Not public</td>
    <td>&#10060; Not public</td>
  </tr>
</table>

## Brisk's Position

The established tools are strong products. They have customers, sales teams, integrations, support teams, and years of market trust.

Brisk is different by design.

<table>
  <tr>
    <td width="33%"><strong>&#127919; Not just a testing app</strong><br />Brisk is built as a local testing control layer that can sit inside another SaaS product or developer platform.</td>
    <td width="33%"><strong>&#128737; AI with guardrails</strong><br />AI helps decide what to test, but Brisk validates the plan before execution.</td>
    <td width="33%"><strong>&#128230; One evidence shape</strong><br />UI, API, contract, adapter, artifact, and result evidence return through one stable contract.</td>
  </tr>
</table>

In simple terms:

> Most testing products sell you a place to run tests. Brisk gives you a testing engine you can embed into your own product.

## Benchmark Framework

A fair AI testing benchmark should not score from websites or vendor demos alone.

Every product should be tested against the same:

| Same input for every product | Why it matters |
|:-----------------------------|:---------------|
| Application and repository | Nobody gets a vendor-selected easy demo |
| Business scenarios | Every tool receives the same user goals |
| API specification | Contract checks are tested equally |
| Environment and time limit | Runtime, flakiness, and setup effort are comparable |
| Evaluator and pass/fail rules | Scores are based on evidence, not opinion |

### Recommended Weighting

| Category | Weight |
|:---------|------:|
| Test-surface discovery | 10% |
| Scenario generation quality | 12% |
| Business-rule and value testing | 8% |
| AI planning control and safety | 10% |
| UI testing capability | 10% |
| API and contract testing | 10% |
| Multi-engine orchestration | 8% |
| Evidence and result quality | 8% |
| Extensibility and embeddability | 8% |
| CI/CD and developer workflow | 5% |
| Reliability and operational maturity | 5% |
| Performance and cost | 3% |
| Commercial and organisational fit | 3% |

### Mandatory Benchmark Scenarios

These are the minimum scenarios a serious comparison should run:

| # | Scenario |
|---:|:---------|
| 1 | Discover an undocumented frontend application |
| 2 | Discover backend routes from source |
| 3 | Parse an OpenAPI contract |
| 4 | Identify mismatch between implementation and contract |
| 5 | Generate positive and negative API scenarios |
| 6 | Execute a multi-step authenticated UI workflow |
| 7 | Validate an exact calculated business value |
| 8 | Validate a rejected action and unchanged state |
| 9 | Handle a changed UI selector |
| 10 | Reject malformed or unsafe AI output |
| 11 | Run UI, API, and contract tests in one execution |
| 12 | Produce machine-readable evidence suitable for CI |

### Two Scores, Not One

One combined score hides the truth. A better benchmark should publish two scores:

| Score | Meaning |
|:------|:--------|
| Product capability score | How well the tool discovers, plans, executes, validates, and reports tests |
| Adoption confidence score | How safe and practical it is for a company to purchase, deploy, support, and trust |

An older enterprise platform may score higher on adoption confidence. A newer architecture may score higher on product capability. Both facts matter.

### Brisk Local Benchmark

Brisk already includes a local benchmark command:

```bash
npm run benchmark
```

Current benchmark coverage is 9 cases across config safety, OpenAPI parsing, discovery warnings, AI plan parsing, API schema validation, undocumented status detection, network policy, and CLI behavior.

This is not yet a full cross-vendor benchmark. It is Brisk's internal proof line. Cross-vendor benchmark numbers should be published only after every product is tested against the same public benchmark app and rules.

## Sources

Product and capability sources:

- mabl: https://www.mabl.com/
- mabl customer stories: https://www.mabl.com/customer-stories
- Katalon: https://katalon.com/
- Katalon customer base: https://katalon.com/about-us
- Tricentis Tosca: https://www.tricentis.com/products/automate-continuous-testing-tosca
- testRigor: https://testrigor.com/
- testRigor API testing: https://testrigor.com/how-to-articles/how-to-do-api-testing-using-testrigor/
- Functionize: https://www.functionize.com/
- Functionize FAQ: https://www.functionize.com/faq

Revenue and company sources:

- mabl revenue estimate: https://growjo.com/company/mabl
- Katalon company profile and revenue estimates: https://growjo.com/company/Katalon
- Tricentis 2024 ARR disclosure: https://www.tricentis.com/news/tricentis-sustains-impressive-2024-growth
- Tricentis $500M ARR announcement: https://www.tricentis.com/news/tricentis-names-kevin-thompson-ceo
- testRigor revenue estimate: https://getlatka.com/companies/testrigor
- Functionize revenue estimate: https://growjo.com/company/Functionize
