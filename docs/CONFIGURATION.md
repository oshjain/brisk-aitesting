# Configuration

`brisk-aitesting` can be configured directly or mapped from a host app's existing config.

## Main Config

The CLI creates `brisk-aitesting.config.mjs` by default. JSON, YAML, and YML config files are also supported for teams that prefer config without executable code.

```js
import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: 'My SaaS',
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

## App

| Field | Meaning |
|:------|:--------|
| `name` | Product name shown in results |
| `baseUrl` | Running app URL |
| `repoPath` | Local repo path used for discovery |
| `env` | Local, CI, staging, or production-like |

## Auth

Supported today:

| Type | Use |
|:-----|:----|
| `none` | Public pages or unauthenticated APIs |
| `credentials` | Username/password flows |
| `bearer` | APIs with bearer tokens |
| `custom` | Host-owned auth metadata |

## AI Provider

Prefer the product namespace:

```bash
BRISK_AITESTING_AI_PROVIDER=openai-compatible
BRISK_AITESTING_AI_ENDPOINT=https://your-gateway.example.com/v1
BRISK_AITESTING_AI_MODEL=your-model
BRISK_AITESTING_AI_API_KEY=your-key
```

Then map it:

```ts
ai: {
  provider: 'openai-compatible',
  endpoint: process.env.BRISK_AITESTING_AI_ENDPOINT,
  model: requiredEnv('BRISK_AITESTING_AI_MODEL'),
  apiKeyEnv: 'BRISK_AITESTING_AI_API_KEY',
}
```

Provider-specific environment variables are compatibility aliases. Product integrations should prefer `BRISK_AITESTING_*`.

The built-in provider path supports:

| Provider value | Meaning |
|:---------------|:--------|
| `openai` | OpenAI-compatible chat-completions endpoint using the standard OpenAI URL |
| `openai-compatible` | Any compatible gateway or self-hosted endpoint |
| `deepseek` | Built-in endpoint mapping for DeepSeek-compatible chat completions |
| `minimax` | Built-in endpoint mapping for MiniMax-compatible chat completions |

For any provider not listed here, use the `AiPlannerProvider` interface and pass your provider adapter through SDK configuration. Do not put unimplemented provider names in config.

## Optional Adapter Commands

Third-party adapters are local and opt-in.

The default package install does not force heavy adapter runtimes into the host application:

```bash
npm install brisk-aitesting
```

Install enhanced adapter runtimes only in the app/package that will run them:

```bash
npm install specmatic
npm install @pact-foundation/pact
```

For pnpm monorepos:

```bash
pnpm add specmatic --filter <your-backend-package>
pnpm add @pact-foundation/pact --filter <your-backend-package>
```

| Setting | Meaning |
|:--------|:--------|
| `BRISK_AITESTING_SCHEMATHESIS_COMMAND` | Path or command name for Schemathesis. Defaults to `st`. |

Specmatic is loaded through the host-installed `specmatic` npm runtime and still needs Java available on the machine. Schemathesis is a Python runtime and should be installed outside npm.

## Host Config Bridge

If your SaaS already has settings, map them instead of duplicating them:

```ts
import { defineConfigFromHost } from 'brisk-aitesting';

export default defineConfigFromHost(hostConfig, (host) => ({
  app: {
    name: host.appName,
    baseUrl: host.publicBaseUrl,
    repoPath: host.repoRoot,
  },
  auth: host.auth,
  ai: host.ai,
  runtime: host.testing.runtime,
  discovery: host.testing.discovery,
  security: host.testing.security,
}));
```

## Security Defaults

Default behavior is local-first:

- network policy: `localhost-only`
- secret redaction: on
- strict plan validation: on
- fallback target execution: off
- UI healing: safe mode
- no hosted dashboard required
- no database required

| Setting | Default | Meaning |
|:--------|:--------|:--------|
| `strictMode` | `true` | AI output must be valid JSON and must pass the public plan contract. |
| `allowFallbackTargets` | `false` | Brisk will not run a scenario against an invented target when discovery could not prove the target. |
| `allowHeuristicWorkflowCapture` | `false` | Brisk will not guess workflow IDs from API responses unless you explicitly opt in. Prefer explicit captures in the plan. |
| `uiHealing` | `safe` | Brisk may try low-risk selector recovery. Destructive actions are not healed in safe mode. |
