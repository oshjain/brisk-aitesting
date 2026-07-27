import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRef, Engine, EngineContext, EngineRunResult, ScenarioPlan, ScenarioResult } from '../types.js';
import { apiUrl, assertContractStatus, assertJsonShape, assertResponseSchema, assertStatus, authHeaders, contractRouteEvidence, findContractOperation, findContractRoute, headersToRecord, isHostAllowed, parseJsonOrNull, redactHeaders, redactValue, scenarioEvidence, scenarioResult, serializeBody, type HeaderRecord } from './shared.js';
export class BuiltinApiEngine implements Engine {
  readonly name = 'builtin-api-engine';
  readonly type = 'api' as const;

  canRun(scenario: ScenarioPlan): boolean {
    return scenario.type === 'api';
  }

  async run(context: EngineContext): Promise<EngineRunResult> {
    const started = Date.now();
    const dir = join(context.config.runtime.artifactsDir, context.runId, 'api');
    await mkdir(dir, { recursive: true });
    const artifactPath = join(dir, `${context.scenario.id}.request-response.json`);
    const url = apiUrl(context);
    const contractRoute = findContractRoute(context);
    const contractOperation = contractRoute === undefined ? undefined : await findContractOperation(contractRoute);
    const headers: HeaderRecord = {
      ...authHeaders(context.config.auth),
      ...context.scenario.request?.headers,
    };
    const method = context.scenario.target?.method ?? 'GET';
    let status: ScenarioResult['status'] = 'passed';
    const diagnostics: string[] = [];
    const assertions: ScenarioResult['assertions'][number][] = [];
    let responseDurationMs = 0;
    let artifactPayload: unknown = {
      schemaVersion: 'brisk-aitesting.api-evidence.v1',
      scenario: scenarioEvidence(context),
      request: {
        method,
        url: url.toString(),
        headers: redactHeaders(headers, context.config.security.redactSecrets),
        body: redactValue(context.scenario.request?.body, context.config.security.redactSecrets),
      },
      response: null,
    };

    if (context.config.runtime.dryRun) {
      status = 'skipped';
      diagnostics.push('Dry run enabled; API request was planned but not executed.');
    } else if (isHostAllowed(url, context.config.security.allowedHosts, context.config.security.networkPolicy)) {
      try {
        const requestStarted = Date.now();
        const response = await fetch(url, {
          method,
          headers,
          ...(context.scenario.request?.body !== undefined ? { body: serializeBody(context.scenario.request.body, headers) } : {}),
          signal: AbortSignal.timeout(context.config.runtime.timeoutMs),
        });
        responseDurationMs = Date.now() - requestStarted;
        const responseText = await response.text();
        const responseJson = parseJsonOrNull(responseText);
        assertions.push(assertStatus(response.status, context.scenario.expect?.status));
        const contractStatusAssertion = assertContractStatus(response.status, contractRoute, context.scenario.expect?.status);
        if (contractStatusAssertion !== undefined) assertions.push(contractStatusAssertion);
        if (context.scenario.expect?.json !== undefined) {
          assertions.push(...assertJsonShape(responseJson, context.scenario.expect.json));
        }
        if (context.scenario.expect?.contains !== undefined) {
          assertions.push({
            name: `response contains ${context.scenario.expect.contains}`,
            status: responseText.includes(context.scenario.expect.contains) ? 'passed' : 'failed',
            ...(responseText.includes(context.scenario.expect.contains) ? {} : { message: 'Expected text was not found in response body.' }),
          });
        }
        const responseSchemaAssertion = assertResponseSchema(response.status, response.headers, responseJson, contractOperation);
        if (responseSchemaAssertion !== undefined) assertions.push(responseSchemaAssertion);
        if (assertions.length === 0) {
          assertions.push({ name: 'response status is below 500', status: response.status < 500 ? 'passed' : 'failed' });
        }
        if (assertions.some((assertion) => assertion.status === 'failed')) status = 'failed';
        diagnostics.push(`HTTP ${response.status} ${response.statusText}`);
        artifactPayload = {
          schemaVersion: 'brisk-aitesting.api-evidence.v1',
          scenario: scenarioEvidence(context),
          timing: {
            startedAt: new Date(requestStarted).toISOString(),
            durationMs: responseDurationMs,
          },
          request: {
            method,
            url: url.toString(),
            headers: redactHeaders(headers, context.config.security.redactSecrets),
            body: redactValue(context.scenario.request?.body, context.config.security.redactSecrets),
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: headersToRecord(response.headers),
            body: responseJson ?? responseText,
          },
          ...(contractRoute !== undefined ? { contract: contractRouteEvidence(contractRoute, contractOperation) } : {}),
          assertions,
          diagnostics,
        };
      } catch (error) {
        status = 'error';
        diagnostics.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      status = 'skipped';
      diagnostics.push(`Network policy blocked host ${url.hostname}`);
    }

    await writeFile(artifactPath, `${JSON.stringify(artifactPayload, null, 2)}\n`, 'utf8');
    const artifact: ArtifactRef = {
      kind: 'json',
      path: artifactPath,
      label: 'API request/response',
      metadata: {
        schemaVersion: 'brisk-aitesting.api-evidence.v1',
        scenarioId: context.scenario.id,
        method,
        url: url.toString(),
        durationMs: responseDurationMs,
        ...(contractRoute !== undefined ? { contractPath: contractRoute.contractPath, operationId: contractRoute.operationId } : {}),
      },
    };

    return {
      artifacts: [artifact],
      result: scenarioResult(context, {
        engine: this.name,
        status,
        durationMs: Date.now() - started,
        artifacts: [artifact],
        diagnostics,
        ...(assertions.length > 0 ? { assertions } : {}),
      }),
    };
  }
}



