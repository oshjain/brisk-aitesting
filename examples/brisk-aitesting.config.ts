import { defineConfig } from 'brisk-aitesting';

const aiCaCertPath = optionalEnv('BRISK_AITESTING_AI_CA_CERT_PATH') ?? optionalEnv('MINIMAX_CA_CERT_PATH');

export default defineConfig({
  app: {
    name: 'Example SaaS',
    baseUrl: 'http://localhost:3000',
    repoPath: '.',
    env: 'local',
  },
  auth: {
    type: 'credentials',
    loginUrl: '/login',
    username: requiredEnv('TEST_USER'),
    password: requiredEnv('TEST_PASSWORD'),
  },
  ai: {
    provider: parseProvider(optionalEnv('BRISK_AITESTING_AI_PROVIDER') ?? 'minimax'),
    model: requiredEnv('BRISK_AITESTING_AI_MODEL'),
    apiKeyEnv: 'BRISK_AITESTING_AI_API_KEY',
    ...(aiCaCertPath !== undefined ? { caCertPath: aiCaCertPath } : {}),
    maxTokens: 128000,
    temperature: 0.1,
  },
  contracts: {
    openApiPath: './openapi.json',
  },
  runtime: {
    artifactsDir: '.brisk-aitesting/artifacts',
    timeoutMs: 120000,
    retries: 1,
    headless: true,
    dryRun: true,
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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for this brisk-aitesting example.`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

function parseProvider(value: string): 'deepseek' | 'minimax' {
  if (value === 'deepseek' || value === 'minimax') return value;
  throw new Error('BRISK_AITESTING_AI_PROVIDER must be deepseek or minimax for this example.');
}
