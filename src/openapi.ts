import { readFile } from 'node:fs/promises';
import type { DiscoveryApiRoute, OpenApiDocumentSummary, OpenApiOperationSummary } from './types.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

type JsonRecord = Record<string, unknown>;

export async function loadOpenApiSummary(path: string): Promise<OpenApiDocumentSummary> {
  const raw = await readFile(path, 'utf8');
  const document = JSON.parse(raw) as unknown;
  return summarizeOpenApiDocument(path, document);
}

export function summarizeOpenApiDocument(path: string, document: unknown): OpenApiDocumentSummary {
  const diagnostics: string[] = [];
  if (!isRecord(document)) {
    return {
      schemaVersion: 'brisk-aitesting.openapi-summary.v1',
      path,
      operations: [],
      diagnostics: ['OpenAPI document must be a JSON object.'],
    };
  }

  const info = isRecord(document.info) ? document.info : undefined;
  const paths = isRecord(document.paths) ? document.paths : undefined;
  const operations: OpenApiOperationSummary[] = [];

  if (paths === undefined) {
    diagnostics.push('OpenAPI document does not define a paths object.');
  } else {
    for (const [operationPath, pathItem] of Object.entries(paths)) {
      if (!isRecord(pathItem)) {
        diagnostics.push(`Path item ${operationPath} is not an object.`);
        continue;
      }
      for (const [rawMethod, operation] of Object.entries(pathItem)) {
        const method = rawMethod.toLowerCase();
        if (!HTTP_METHODS.has(method)) continue;
        if (!isRecord(operation)) {
          diagnostics.push(`${rawMethod.toUpperCase()} ${operationPath} operation is not an object.`);
          continue;
        }
        operations.push(summarizeOperation(operationPath, method.toUpperCase(), operation));
      }
    }
  }

  if (operations.length === 0) diagnostics.push('OpenAPI document did not expose any HTTP operations.');

  return {
    schemaVersion: 'brisk-aitesting.openapi-summary.v1',
    path,
    ...(typeof info?.title === 'string' ? { title: info.title } : {}),
    ...(typeof info?.version === 'string' ? { version: info.version } : {}),
    ...(typeof document.openapi === 'string'
      ? { openapiVersion: document.openapi }
      : typeof document.swagger === 'string'
        ? { openapiVersion: document.swagger }
        : {}),
    operations,
    diagnostics,
  };
}

export function openApiOperationsToDiscoveryRoutes(summary: OpenApiDocumentSummary): readonly DiscoveryApiRoute[] {
  return summary.operations.map((operation) => ({
    method: operation.method,
    path: operation.path,
    source: 'contract',
    confidence: 0.95,
    ...(operation.operationId !== undefined ? { operationId: operation.operationId } : {}),
    ...(operation.summary !== undefined ? { summary: operation.summary } : {}),
    ...(operation.tags.length > 0 ? { tags: operation.tags } : {}),
    contractPath: summary.path,
    ...(operation.statusCodes.length > 0 ? { statusCodes: operation.statusCodes } : {}),
  }));
}

function summarizeOperation(path: string, method: string, operation: JsonRecord): OpenApiOperationSummary {
  const requestBody = isRecord(operation.requestBody) ? operation.requestBody : undefined;
  const responses = isRecord(operation.responses) ? operation.responses : undefined;

  return {
    method,
    path,
    ...(typeof operation.operationId === 'string' ? { operationId: operation.operationId } : {}),
    ...(typeof operation.summary === 'string' ? { summary: operation.summary } : {}),
    tags: Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    statusCodes: summarizeStatusCodes(responses),
    requestBodyRequired: requestBody?.required === true,
    requestContentTypes: summarizeContentTypes(requestBody),
    responseContentTypes: summarizeResponseContentTypes(responses),
  };
}

function summarizeStatusCodes(responses: JsonRecord | undefined): readonly number[] {
  if (responses === undefined) return [];
  return Object.keys(responses)
    .map((status) => Number(status))
    .filter((status) => Number.isInteger(status) && status >= 100 && status <= 599)
    .sort((left, right) => left - right);
}

function summarizeContentTypes(value: JsonRecord | undefined): readonly string[] {
  const content = isRecord(value?.content) ? value.content : undefined;
  return content === undefined ? [] : Object.keys(content).sort();
}

function summarizeResponseContentTypes(responses: JsonRecord | undefined): readonly string[] {
  if (responses === undefined) return [];
  const contentTypes = new Set<string>();
  for (const response of Object.values(responses)) {
    if (!isRecord(response)) continue;
    for (const contentType of summarizeContentTypes(response)) {
      contentTypes.add(contentType);
    }
  }
  return [...contentTypes].sort();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
