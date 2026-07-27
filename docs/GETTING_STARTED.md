# Getting Started

This guide gets `brisk-aitesting` running in a real project.

## Install

```bash
npm install brisk-aitesting
```

If you want browser testing, install Playwright in the host project too:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Create Config

```bash
npx brisk-aitesting init
```

This creates `brisk-aitesting.config.ts`.

Set the minimum values first:

```ts
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
  },
});
```

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

