# Competitive Comparison

This page compares `brisk-aitesting` with large, established software testing platforms that have serious market presence, long operating history, analyst visibility, and public revenue signals.

This is the correct comparison lens for Brisk:

- not just small AI testing startups
- not only tools that say "plain English testing"
- not only browser-testing tools
- established testing companies with money, market trust, and enterprise reach

Revenue notes:

- some companies disclose total company revenue, not testing-product-only revenue
- private-company revenue numbers are estimates unless clearly disclosed
- where a product is part of a larger company, the table says so directly

## Enterprise Peer Set

| Product/company | Why it belongs in this comparison | Revenue signal |
|:----------------|:----------------------------------|:---------------|
| Tricentis | Enterprise test automation platform with Tosca, Testim, qTest, NeoLoad, and AI-assisted testing | Tricentis reported ARR above $400M for 2024 and later announced ARR above $500M |
| OpenText | Large enterprise software company with OpenText Functional Testing and AI-augmented testing capabilities | OpenText reported $5.168B total revenue for fiscal 2025 |
| Keysight Eggplant | Long-running model-based and AI-assisted testing product inside Keysight Technologies | Keysight reported $5.37B total revenue for fiscal 2025; Eggplant is part of the Keysight portfolio |
| UiPath Test Cloud | Enterprise automation company with test automation, AI, RPA, and workflow automation reach | UiPath reported $1.430B revenue and $1.666B ARR for fiscal 2025 |
| BrowserStack | Large cloud testing platform used by developer and QA teams, now adding AI-assisted test creation and execution | BrowserStack revenue is private; public estimates commonly place it in the hundreds of millions of dollars |

## What A Serious AI Testing Product Must Cover

| Capability | Why buyers care |
|:-----------|:----------------|
| Natural-language test intent | Teams should describe what matters without hand-coding every test |
| UI, API, and contract coverage | Real products are not only screens; they are screens, APIs, schemas, auth, data, and workflows |
| AI safety boundary | AI should help plan tests, but should not be blindly trusted to execute arbitrary code |
| Local or embeddable control | Enterprises often need tests to run inside their own product, CI, network, and security model |
| Evidence handover | Results should come back as stable data that any dashboard, database, or CI system can consume |

## 10-Point Comparison Matrix

Legend: `yes` means the capability is clearly offered or built. `partial` means the product has an adjacent capability, but not the same shape. `not clear` means the capability was not found as a clear public claim in the cited sources.

| # | Capability | Brisk | Tricentis | OpenText | Keysight Eggplant | UiPath Test Cloud | BrowserStack |
|---:|:-----------|:-----:|:---------:|:--------:|:-----------------:|:-----------------:|:------------:|
| 1 | Human-language testing goal to executable test flow | yes | partial | partial | partial | partial | partial |
| 2 | UI testing | yes | yes | yes | yes | yes | yes |
| 3 | API testing | yes | yes | yes | partial | yes | yes |
| 4 | OpenAPI/schema contract testing | yes | yes | partial | partial | partial | partial |
| 5 | Repository, route, and contract discovery before planning | yes | not clear | not clear | partial | not clear | not clear |
| 6 | AI output validated as a structured plan before execution | yes | not clear | not clear | not clear | not clear | not clear |
| 7 | AI never directly executes arbitrary generated code | yes | not clear | not clear | not clear | not clear | not clear |
| 8 | Local SDK/CLI that can be embedded into another product | yes | partial | partial | partial | partial | partial |
| 9 | One versioned JSON result contract for host-owned dashboards and databases | yes | not clear | not clear | not clear | not clear | not clear |
| 10 | Third-party engine/adaptor model under one evidence contract | yes | partial | partial | partial | partial | partial |

## What This Shows

The large platforms are powerful and mature. They usually win on enterprise sales, hosted execution, broad integrations, commercial support, and years of buyer trust.

Brisk is designed for a different job.

It is not trying to be another hosted testing dashboard. It is a local, embeddable testing control layer that can sit inside a SaaS product, developer platform, internal tool, or CI pipeline.

That difference matters:

- the host product owns the UI, database, users, permissions, and reporting
- Brisk owns discovery, planning, validation, engine routing, execution, and evidence
- AI helps decide what should be tested, but Brisk checks the plan before anything runs
- UI, API, OpenAPI, Playwright, Schemathesis, artifacts, and final results can return through one stable handover shape

In simple terms:

> Established tools sell testing platforms. Brisk gives teams a testing engine they can embed into their own platform.

That is the market opening.

## Sources

Product and capability sources:

- Tricentis product portfolio and Testim: https://www.tricentis.com/products and https://www.tricentis.com/products/test-automation-web-apps-testim
- Tricentis AI and 2024 growth: https://www.tricentis.com/news/tricentis-sustains-impressive-2024-growth
- OpenText Functional Testing: https://www.opentext.com/products/functional-testing
- OpenText AI-augmented testing recognition: https://www.opentext.com/about/press-releases/opentext-named-a-leader-in-the-2025-gartner-magic-quadrant-for-ai-augmented-software-testing-tools
- Keysight Eggplant: https://www.keysight.com/us/en/products/software/software-testing/eggplant-test.html
- Keysight AI-augmented testing recognition: https://www.keysight.com/us/en/about/newsroom/news-releases/2025/0716-nr25085-keysight-named-a-leader-in-the-2025-gartner-magic-quadrant-for-ai-augmented-software-testing-tools.html
- UiPath Test Cloud: https://www.uipath.com/product/test-cloud
- BrowserStack AI testing: https://www.browserstack.com/ai

Revenue sources:

- Tricentis 2024 ARR disclosure: https://www.tricentis.com/news/tricentis-sustains-impressive-2024-growth
- Tricentis $500M ARR announcement: https://www.tricentis.com/news/tricentis-names-kevin-thompson-ceo
- OpenText fiscal 2025 results: https://investors.opentext.com/press-releases/press-releases-details/2025/OpenText-Reports-Fourth-Quarter-and-Fiscal-Year-2025-Financial-Results/default.aspx
- Keysight fiscal 2025 results: https://www.keysight.com/us/en/about/newsroom/news-releases/2025/1124-nr25123-keysight-reports-fourth-quarter-2025-results.html
- UiPath fiscal 2025 results: https://ir.uipath.com/news/detail/349/uipath-reports-fourth-quarter-and-full-year-fiscal-2025-financial-results
- BrowserStack revenue estimate: https://sacra.com/c/browserstack/
