# Configuration

`brisk-aitesting` can be configured directly or mapped from a host app's existing config.

## Main Config

The config file is usually named `brisk-aitesting.config.ts`.

```ts
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

## Optional Adapter Commands

Third-party adapters are local and opt-in.

| Setting | Meaning |
|:--------|:--------|
| `BRISK_AITESTING_SCHEMATHESIS_COMMAND` | Path or command name for Schemathesis. Defaults to `st`. |

Specmatic is loaded through the optional `specmatic` npm runtime and still needs Java available on the machine.

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
- no hosted dashboard required
- no database required
