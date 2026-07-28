import type { ScenarioPlan } from './types.js';

export interface BriskReplayRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly expectStatus?: number;
}

export interface KeployHttpTestCase {
  readonly kind?: string;
  readonly name?: string;
  readonly spec?: {
    readonly req?: unknown;
    readonly resp?: unknown;
  };
  readonly req?: unknown;
  readonly resp?: unknown;
}

export function keployToReplayRequests(value: unknown): readonly BriskReplayRequest[] {
  const cases = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.tests) ? value.tests : [value];
  return cases
    .map(keployCaseToReplayRequest)
    .filter((request): request is BriskReplayRequest => request !== undefined);
}

export function replayRequestsToKeployCases(name: string, requests: readonly BriskReplayRequest[]): readonly KeployHttpTestCase[] {
  return requests.map((request, index) => ({
    kind: 'Http',
    name: `${name}-${index + 1}`,
    spec: {
      req: {
        method: request.method,
        url: request.path,
        header: request.headers ?? {},
        ...(request.body !== undefined ? { body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body) } : {}),
      },
      resp: {
        status_code: request.expectStatus ?? 200,
      },
    },
  }));
}

export function scenarioReplayRequests(scenario: ScenarioPlan): readonly BriskReplayRequest[] {
  const replay = scenario.metadata?.replay;
  if (!isRecord(replay)) return [];
  const nativeRequests = Array.isArray(replay.requests) ? replay.requests.map(normalizeReplayRequest).filter((request): request is BriskReplayRequest => request !== undefined) : [];
  const keployRequests = replay.keploy !== undefined ? keployToReplayRequests(replay.keploy) : [];
  return [...nativeRequests, ...keployRequests];
}

function keployCaseToReplayRequest(value: unknown): BriskReplayRequest | undefined {
  if (!isRecord(value)) return undefined;
  const spec = isRecord(value.spec) ? value.spec : value;
  const req = isRecord(spec.req) ? spec.req : isRecord(spec.httpReq) ? spec.httpReq : isRecord(spec.httpreq) ? spec.httpreq : undefined;
  if (req === undefined) return undefined;
  const resp = isRecord(spec.resp) ? spec.resp : isRecord(spec.httpResp) ? spec.httpResp : isRecord(spec.httpresp) ? spec.httpresp : undefined;
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
  const rawPath = typeof req.url === 'string' ? req.url : typeof req.path === 'string' ? req.path : undefined;
  if (rawPath === undefined) return undefined;
  const path = normalizePath(rawPath);
  const headers = normalizeHeaders(req.header ?? req.headers);
  const body = typeof req.body === 'string' && looksJson(req.body) ? JSON.parse(req.body) as unknown : req.body;
  const expectStatus = isRecord(resp) && typeof resp.status_code === 'number'
    ? resp.status_code
    : isRecord(resp) && typeof resp.statusCode === 'number'
      ? resp.statusCode
      : undefined;
  return {
    method,
    path,
    ...(headers !== undefined ? { headers } : {}),
    ...(body !== undefined && body !== '' ? { body } : {}),
    ...(expectStatus !== undefined ? { expectStatus } : {}),
  };
}

function normalizeReplayRequest(value: unknown): BriskReplayRequest | undefined {
  if (!isRecord(value) || typeof value.path !== 'string') return undefined;
  const method = typeof value.method === 'string' ? value.method.toUpperCase() : 'GET';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return undefined;
  const headers = normalizeHeaders(value.headers);
  const expectStatus = typeof value.expectStatus === 'number' && Number.isInteger(value.expectStatus) ? value.expectStatus : undefined;
  return {
    method,
    path: normalizePath(value.path),
    ...(headers !== undefined ? { headers } : {}),
    ...(value.body !== undefined ? { body: value.body } : {}),
    ...(expectStatus !== undefined ? { expectStatus } : {}),
  };
}

function normalizePath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value.startsWith('/') ? value : `/${value}`;
  }
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    if (typeof entry === 'string') return [[key, entry] as const];
    if (Array.isArray(entry) && typeof entry[0] === 'string') return [[key, entry[0]] as const];
    return [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function looksJson(value: string): boolean {
  const trimmed = value.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
