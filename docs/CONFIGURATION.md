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
    maxSourceFiles: 20000,
    uiRoutes: ['/'],
    apiRoutes: [{ method: 'GET', path: '/api/health' }],
  },
  security: {
    networkPolicy: 'localhost-only',
    allowedHosts: ['localhost', '127.0.0.1', '::1'],
    redactSecrets: true,
    strictMode: true,
    allowFallbackTargets: false,
    allowHeuristicWorkflowCapture: false,
    uiHealing: 'safe',
    allowLegacyFullContextEvidenceProviders: false,
    requireEvidenceProviderTenantId: false,
    requireEvidenceWorkerHostIsolation: false,
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

With an `aiProvider`, the default planner requests non-executable `brisk-aitesting.intent.v1` and compiles it against authoritative capability evidence. Configure `contracts.openApiPath` for OpenAPI applications. For host-owned operation registries, configure `capabilityAdapters` and pass an `evidenceGraph` with the run input. See [UNIVERSAL_COMPILER.md](UNIVERSAL_COMPILER.md).

## Missing-information planning

When compilation finds an evidence gap, registered `evidenceProviders` can
obtain the missing information and trigger automatic recompilation.

| Field | Default | Allowed | Meaning |
|:------|:--------|:--------|:--------|
| `planning.evidenceAcquisitionRounds` | `2` | integer `0..5` | Maximum bounded rounds; `0` disables acquisition |
| `planning.evidenceProviderTimeoutMs` | smaller of run timeout and `30000` | integer `1..3600000` | Maximum time for one provider call |
| `planning.evidenceCacheTtlMs` | `300000` | integer `0..86400000` | How long a validated in-memory result can be reused; `0` disables cache reuse |
| `planning.evidenceCacheMaxEntries` | `64` | integer `0..1024` | Maximum in-memory results retained; `0` disables cache reuse |
| `planning.evidenceMaxResponseBytes` | `10485760` | integer `1024..104857600` | Maximum serialized provider response size accepted for merging |
| `planning.evidenceMaxGraphsPerResponse` | `16` | integer `1..1024` | Maximum evidence graphs accepted from one provider response |
| `planning.evidenceMaxOperationsPerResponse` | `10000` | integer `1..100000` | Maximum combined operations accepted from one provider response |
| `planning.evidenceMaxArtifactsPerResponse` | `1000` | integer `0..10000` | Maximum artifact references accepted from one provider response |

The cache is memory-only and bounded. Providers may implement `checkFreshness`
and `refresh` to validate their upstream source. Unknown or invalid source
freshness causes reacquisition rather than silent cached reuse. See
[EVIDENCE_PROVIDERS.md](EVIDENCE_PROVIDERS.md) for the exact full, partial,
missing, invalid, digest, freshness, invalidation, refresh, retention, and
resource-limit rules.

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
- old helpers that receive passwords and the full run context: blocked
- helper tenant ID: optional unless the host requires it
- separate helper-worker file/network isolation: reported, but host enforcement is optional unless required
- no hosted dashboard required
- no database required

| Setting | Default | Meaning |
|:--------|:--------|:--------|
| `strictMode` | `true` | Intent, compiler output, lowered plans, and legacy executable plans must pass their deterministic gates. |
| `allowFallbackTargets` | `false` | Brisk will not run a scenario against an invented target when discovery could not prove the target. |
| `allowHeuristicWorkflowCapture` | `false` | Brisk will not guess workflow IDs from API responses unless explicitly enabled. Semantic compilation derives captures from typed evidence. |
| `uiHealing` | `safe` | Brisk may try low-risk selector recovery. Destructive actions are not healed in safe mode. |
| `allowLegacyFullContextEvidenceProviders` | `false` | Blocks old helpers that receive the complete configuration and run input. Enable only for reviewed trusted code during migration. |
| `requireEvidenceProviderTenantId` | `false` | Blocks missing-information acquisition unless the run input contains a valid explicit `tenantId`. |
| `requireEvidenceWorkerHostIsolation` | `false` | When enabled, refuses to start a separate helper worker unless trusted host configuration declares both file and network isolation as host-enforced. |

`tenantId` belongs on the individual run input, not global configuration. It
separates helper requests and cached information for different customers. The
host must still verify who the caller is and which tenant that caller may use.

The worker-isolation declaration is not self-proving. Use the required setting
only with a launcher, container, or host policy that actually establishes the
declared file and network restrictions.
