# Getting Started

This guide gets `brisk-aitesting` running in a real project.

## Install

```bash
npm install brisk-aitesting
```

For pnpm monorepos, install it in the backend package that will run discovery, AI planning, engines, and artifact writing:

```bash
pnpm add brisk-aitesting --filter <your-backend-package>
```

Example:

```bash
pnpm add brisk-aitesting --filter @your-org/api
```

If your project already installs Playwright and browser binaries, keep using that setup. If it does not, install Playwright in the same backend/runtime package:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Optional Adapter Runtimes

Brisk ships adapter code for Schemathesis, Specmatic, and Pact. The external tools stay opt-in so a normal install stays light and reliable.

Default install:

```bash
npm install brisk-aitesting
```

Enhanced adapter installs:

| Adapter | Install only when you need it | Command |
| --- | --- | --- |
| Schemathesis | Deep OpenAPI fuzzing | Install Python plus Schemathesis on the machine |
| Specmatic | Specmatic contract execution and mock/service virtualization | `npm install specmatic` plus Java |
| Pact | Pact message verification | `npm install @pact-foundation/pact` |

For pnpm monorepos, install enhanced adapters in the same backend package that runs `brisk-aitesting`:

```bash
pnpm add specmatic --filter <your-backend-package>
pnpm add @pact-foundation/pact --filter <your-backend-package>
```

Specmatic can test any HTTP/OpenAPI provider; the app under test does not have to be Java. Java is needed because the Specmatic runtime uses a Java executable.


## Create Config

```bash
npx brisk-aitesting init
```

This creates `brisk-aitesting.config.mjs`.

Set the minimum values first:

```js
import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: 'My App',
    baseUrl: 'http://localhost:3000',
    repoPath: '.',
    env: 'local',
  },
  auth: { type: 'none' },
  runtime: {
    artifactsDir: '.brisk-aitesting/artifacts',
    timeoutMs: 120000,
    retries: 1,
    headless: true,
    dryRun: false,
  },
  discovery: {
    includeRepo: true,
    includeUi: true,
    includeApi: true,
    includeContracts: true,
  },
  security: {
    networkPolicy: 'localhost-only',
    allowedHosts: ['localhost', '127.0.0.1', '::1'],
    redactSecrets: true,
    strictMode: true,
    allowFallbackTargets: false,
    allowHeuristicWorkflowCapture: false,
    uiHealing: 'safe',
  },
});
```

Before the first run, check the local setup:

```bash
npx brisk-aitesting doctor
```

`doctor` checks the config, app URL, contracts, auth reachability, browser runtime, AI provider settings, security mode, and optional adapter prerequisites. It is meant to catch boring setup mistakes before they become confusing test failures.

## Run

```bash
npx brisk-aitesting run --goal "Test login, dashboard, API contracts, and permissions" --scenarios 10
```

For a machine-readable result:

```bash
npx brisk-aitesting run --goal "Test core API behavior" --json --output .brisk-aitesting/result.json
```

## What You Get

Every run returns:

- a status: `passed`, `failed`, `error`, or `skipped`
- scenario results
- pass rate and duration
- evidence artifacts
- a stable result JSON object your app can store or display

## First Good Use Cases

- verify OpenAPI routes
- check login and dashboard loading
- test protected API behavior
- run pull-request checks
- produce one result object for an internal dashboard
