import { defineConfig } from 'brisk-aitesting';

export default defineConfig({
  app: {
    name: "My SaaS",
    baseUrl: "http://localhost:3000",
    repoPath: '.',
    env: 'local',
  },
  auth: {
    type: 'none',
  },
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
    allowHeuristicWorkflowCapture: true,
    uiHealing: 'safe',
  },
});
