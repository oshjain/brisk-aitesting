# Troubleshooting

This guide maps common failures to direct fixes.

## Missing Playwright

Error:

```text
Cannot find module '@playwright/test/package.json'
```

Fix:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## App Is Not Reachable

Symptoms:

- UI tests fail at page load
- API checks return network errors
- discovery finds defaults only

Fix:

- start the app
- confirm `app.baseUrl`
- check firewall, VPN, proxy, or container networking
- update `security.allowedHosts` if using staging

## AI Provider Fails

Symptoms:

- missing API key
- invalid JSON from provider
- TLS certificate error

Fix:

- set `BRISK_AITESTING_AI_API_KEY`
- set `BRISK_AITESTING_AI_MODEL`
- set `BRISK_AITESTING_AI_ENDPOINT` for gateways
- set `ai.caCertPath` or `NODE_EXTRA_CA_CERTS` for enterprise TLS

## UI Element Not Found

Why it happens:

- page changed after grounding
- element has no stable label, role, text, or test id
- auth redirected the page
- app loaded slowly

Fix:

- add test IDs or accessible labels
- confirm auth config
- increase `runtime.timeoutMs`
- use `uiActionFeedback: 'always'` for stronger grounding

## OpenAPI Contract Not Found

Fix:

```ts
contracts: {
  openApiPath: './openapi.yaml',
}
```

The path is resolved from the current working directory unless you pass an absolute path.

## Clean Local Artifacts

```bash
npx brisk-aitesting clean
```

This removes Brisk-generated local artifacts and workspaces.

To also remove Playwright's standard output folders:

```bash
npx brisk-aitesting clean --include-playwright-output
```
