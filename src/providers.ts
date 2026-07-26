import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AiPlannerProvider, AiPlannerProviderRequest, AiPlannerProviderResponse, AiProviderConfig } from './types.js';

export class BriskAiTestingProviderError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly diagnosis: string;
  readonly resolution: readonly string[];

  constructor(params: {
    readonly code: string;
    readonly provider: string;
    readonly message: string;
    readonly diagnosis: string;
    readonly resolution: readonly string[];
    readonly cause?: unknown;
  }) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = 'BriskAiTestingProviderError';
    this.code = params.code;
    this.provider = params.provider;
    this.diagnosis = params.diagnosis;
    this.resolution = params.resolution;
  }
}

export class OpenAiCompatibleProvider implements AiPlannerProvider {
  readonly name: string;

  constructor(private readonly config: AiProviderConfig) {
    this.name = `${config.provider}-planner-provider`;
  }

  async complete(request: AiPlannerProviderRequest): Promise<AiPlannerProviderResponse> {
    const apiKey = resolveApiKey(this.config);
    if (apiKey.length === 0) {
      throw new Error(`Missing API key for ${this.config.provider}. Set ai.apiKey or ai.apiKeyEnv.`);
    }

    const response = await requestProvider(this.config, apiKey, request);

    const body = parseProviderJson(response.body, this.config.provider);
    if (!response.ok) {
      throw new Error(`${this.config.provider} request failed with HTTP ${response.status}: ${safeStringify(body)}`);
    }
    const usage = extractUsage(body);
    return {
      content: extractChatContent(body),
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}

interface ProviderHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

async function requestProvider(
  config: AiProviderConfig,
  apiKey: string,
  request: AiPlannerProviderRequest,
): Promise<ProviderHttpResponse> {
  const url = new URL(chatCompletionsUrl(config));
  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    temperature: config.temperature ?? 0.1,
    max_tokens: config.maxTokens ?? 4096,
    stream: false,
  });

  try {
    const ca = config.caCertPath !== undefined ? await readFile(config.caCertPath, 'utf8') : undefined;
    return await new Promise<ProviderHttpResponse>((resolve, reject) => {
      const client = url.protocol === 'http:' ? httpRequest : httpsRequest;
      const req = client({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        ...(ca !== undefined && url.protocol === 'https:' ? { ca } : {}),
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (error) {
    throw classifyProviderConnectionError(config.provider, error);
  }
}

function parseProviderJson(body: string, provider: AiProviderConfig['provider']): unknown {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new BriskAiTestingProviderError({
      code: 'AI_PROVIDER_INVALID_JSON_RESPONSE',
      provider,
      message: `${provider} returned a response that was not valid JSON.`,
      diagnosis: 'The provider endpoint responded, but the body was not an OpenAI-compatible JSON response.',
      resolution: [
        'Confirm ai.endpoint points to the provider chat completions API.',
        'Check whether a proxy, gateway, or login page is returning HTML instead of JSON.',
      ],
      cause: error,
    });
  }
}

function classifyProviderConnectionError(provider: AiProviderConfig['provider'], error: unknown): BriskAiTestingProviderError {
  const code = nestedErrorCode(error);
  if (code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return new BriskAiTestingProviderError({
      code: 'AI_PROVIDER_TLS_TRUST_FAILED',
      provider,
      message: `${provider} connection failed because Node.js could not validate the TLS certificate chain.`,
      diagnosis: 'The AI provider path is configured and being used, but this machine or network is missing the required trusted CA certificate for outbound HTTPS.',
      resolution: [
        'Set ai.caCertPath to the corporate/root CA PEM certificate file, or set the matching provider CA env value used by your config.',
        'Alternatively start Node with NODE_EXTRA_CA_CERTS pointing to the PEM certificate file.',
        'Confirm the configured ai.endpoint is the expected provider endpoint and is not being intercepted by an untrusted proxy.',
        'Run the smoke again after fixing certificate trust; do not disable TLS verification for a real product or CI setup.',
      ],
      cause: error,
    });
  }

  return new BriskAiTestingProviderError({
    code: 'AI_PROVIDER_CONNECTION_FAILED',
    provider,
    message: `${provider} connection failed before a response was received.`,
    diagnosis: 'The AI provider could not be reached from the current runtime.',
    resolution: [
      'Check network access, proxy configuration, DNS, firewall rules, and the configured ai.endpoint.',
      'Verify the provider API key and model only after network connectivity succeeds.',
    ],
    cause: error,
  });
}

function nestedErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const direct = (error as { readonly code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause !== undefined) return nestedErrorCode(cause);
  return undefined;
}

export function createAiProviderFromConfig(config: AiProviderConfig): AiPlannerProvider {
  if (['openai', 'openai-compatible', 'deepseek', 'minimax'].includes(config.provider)) {
    return new OpenAiCompatibleProvider(config);
  }
  throw new Error(`Provider "${config.provider}" is not implemented yet. Use openai-compatible, deepseek, or minimax.`);
}

function resolveApiKey(config: AiProviderConfig): string {
  if (config.apiKey !== undefined && config.apiKey.length > 0) return config.apiKey;
  if (config.apiKeyEnv !== undefined && config.apiKeyEnv.length > 0) return process.env[config.apiKeyEnv] ?? '';
  if (process.env.BRISK_AITESTING_AI_API_KEY !== undefined) return process.env.BRISK_AITESTING_AI_API_KEY;
  if (config.provider === 'deepseek') return process.env.DEEPSEEK_API_KEY ?? '';
  if (config.provider === 'minimax') return process.env.MINIMAX_API_KEY ?? '';
  if (config.provider === 'openai') return process.env.OPENAI_API_KEY ?? '';
  return '';
}

function chatCompletionsUrl(config: AiProviderConfig): string {
  const endpoint = (config.endpoint ?? defaultEndpoint(config.provider)).replace(/\/+$/, '');
  if (endpoint.endsWith('/chat/completions')) return endpoint;
  return `${endpoint}/chat/completions`;
}

function defaultEndpoint(provider: AiProviderConfig['provider']): string {
  if (provider === 'deepseek') return 'https://api.deepseek.com';
  if (provider === 'minimax') return 'https://api.minimax.io/v1';
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'openai-compatible') return 'http://localhost:11434/v1';
  return '';
}

function extractChatContent(value: unknown): string {
  if (value === null || typeof value !== 'object') throw new Error('Provider returned a non-object response.');
  const choices = (value as { readonly choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error('Provider response did not include choices.');
  const first = choices[0] as { readonly message?: { readonly content?: unknown } };
  if (typeof first.message?.content !== 'string') throw new Error('Provider response did not include message.content.');
  return first.message.content;
}

function extractUsage(value: unknown): AiPlannerProviderResponse['usage'] {
  if (value === null || typeof value !== 'object') return undefined;
  const usage = (value as { readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown } }).usage;
  if (usage === undefined) return undefined;
  return {
    ...(typeof usage.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === 'number' ? { outputTokens: usage.completion_tokens } : {}),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
