import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);
const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
const readme = await readFile(join(packageDir, 'README.md'), 'utf8');
const architecture = await readFile(join(packageDir, 'docs', 'ARCHITECTURE.md'), 'utf8');
const statusDoc = await readFile(join(packageDir, 'docs', 'STATUS.md'), 'utf8');
const types = await readFile(join(packageDir, 'dist', 'types.d.ts'), 'utf8');
const indexTypes = await readFile(join(packageDir, 'dist', 'index.d.ts'), 'utf8');

const expectedRuntimeExports = [
  'AiPlanner',
  'BriskAiTesting',
  'BriskAiTestingProviderError',
  'BuiltinApiEngine',
  'BuiltinContractEngine',
  'BuiltinDiscoverer',
  'BuiltinMessageContractEngine',
  'BuiltinPlanner',
  'BuiltinPlanValidator',
  'BuiltinPlaywrightEngine',
  'BuiltinPlaywrightRouteGrounder',
  'BuiltinReplayEngine',
  'BuiltinSchemaFuzzEngine',
  'OpenAiCompatibleProvider',
  'SchemathesisOpenApiFuzzEngine',
  'createInvalidSchemaExample',
  'createAiProviderFromConfig',
  'createBriskAiTesting',
  'createSchemaExample',
  'defineConfig',
  'defineConfigFromHost',
  'loadConfig',
  'loadEnvFiles',
  'loadOpenApiSummary',
  'keployToReplayRequests',
  'mergeConfig',
  'openApiOperationsToDiscoveryRoutes',
  'normalizeConfig',
  'parseAiPlanForTesting',
  'planJsonSchema',
  'replayRequestsToKeployCases',
  'runEnginePluginConformance',
  'runExtensionConformance',
  'scenarioReplayRequests',
  'summarizeOpenApiDocument',
  'validateJsonSchema',
  'validatePlanJsonContract',
];

const expectedTypeExports = [
  'AiPlannerProvider',
  'ApiStateSnapshotExpectation',
  'ArtifactRef',
  'BriskReplayRequest',
  'BriskAiTestingConfig',
  'BriskAiTestingEvent',
  'BriskAiTestingResult',
  'BriskAiTestingRunInput',
  'ContractDriftReport',
  'ContractDriftRoute',
  'Engine',
  'EnginePluginConformanceReport',
  'ExtensionConformanceCase',
  'ExtensionConformanceExtensionReport',
  'ExtensionConformanceReport',
  'KeployHttpTestCase',
  'OpenApiDocumentSummary',
  'OpenApiOperationSummary',
  'OpenApiResponseSummary',
  'Planner',
  'PlanValidator',
  'ScenarioPlan',
  'ScenarioResult',
  'TestPlan',
  'UiActionEnrichmentContext',
  'UiActionPlan',
  'UiElementEvidence',
  'UiGroundingEvidence',
  'UiRouteGrounder',
  'UiRouteGrounderContext',
  'UiRouteGrounderResult',
  'ValidationResult',
  'SchemaValidationResult',
  'SchemathesisEngineOptions',
];

const expectedSchemas = [
  'brisk-aitesting.plan.v1',
  'brisk-aitesting.validation.v1',
  'brisk-aitesting.discovery.v1',
  'brisk-aitesting.contract-drift.v1',
  'brisk-aitesting.result.v1',
  'brisk-aitesting.handover.v1',
  'brisk-aitesting.cli-result.v1',
  'brisk-aitesting.clean-result.v1',
  'brisk-aitesting.benchmark.v1',
  'brisk-aitesting.pack-check.v1',
  'brisk-aitesting.release-readiness.v1',
  'brisk-aitesting.adapter-manifest.v1',
  'brisk-aitesting.adapter-readiness.v1',
  'brisk-aitesting.engine-conformance.v1',
  'brisk-aitesting.plugin-conformance.v1',
  'brisk-aitesting.plugin-conformance-smoke.v1',
  'brisk-aitesting.extension-conformance.v1',
  'brisk-aitesting.extension-conformance-smoke.v1',
  'brisk-aitesting.schemathesis-evidence.v1',
  'brisk-aitesting.schemathesis-smoke.v1',
  'brisk-aitesting.reference-serious-saas.v1',
  'brisk-aitesting.reference-proof-apps.v1',
  'brisk-aitesting.golden-fixtures.v1',
  'brisk-aitesting.junit-report.v1',
  'brisk-aitesting.html-report.v1',
  'brisk-aitesting.schema-fuzz-evidence.v1',
  'brisk-aitesting.replay-evidence.v1',
  'brisk-aitesting.api-evidence.v1',
  'brisk-aitesting.message-contract-evidence.v1',
  'brisk-aitesting.openapi-summary.v1',
  'brisk-aitesting.playwright-evidence.v1',
  'brisk-aitesting.ui-grounding.v1',
  'brisk-aitesting.ui-actions.v1',
  'brisk-aitesting.ui-healing.v1',
];

const expectedScripts = [
  'build',
  'typecheck',
  'smoke',
  'smoke:contracts',
  'smoke:engine-conformance',
  'smoke:plugin-conformance',
  'smoke:extension-conformance',
  'smoke:adapter-readiness',
  'smoke:schemathesis',
  'smoke:reference-serious-saas',
  'smoke:reference-proof-apps',
  'smoke:golden-fixtures',
  'smoke:cli',
  'smoke:ai-fixtures',
  'smoke:ci',
  'smoke:real-ai',
  'smoke:all',
  'benchmark',
  'pack:check',
  'release:check',
];

const errors = [];

for (const name of expectedRuntimeExports) {
  if (!(name in api)) errors.push(`missing runtime export ${name}`);
}

for (const name of expectedTypeExports) {
  if (!types.includes(`export interface ${name}`) && !types.includes(`export type ${name}`) && !indexTypes.includes(name)) {
    errors.push(`missing type declaration export ${name}`);
  }
}

for (const schema of expectedSchemas) {
  if (!readme.includes(schema)) errors.push(`README missing schema ${schema}`);
  if (!architecture.includes(schema)) errors.push(`ARCHITECTURE missing schema ${schema}`);
  if (!statusDoc.includes(schema) && schema === 'brisk-aitesting.pack-check.v1') errors.push(`STATUS missing schema ${schema}`);
}

for (const script of expectedScripts) {
  if (typeof packageJson.scripts?.[script] !== 'string') errors.push(`package.json missing script ${script}`);
}

if (!Array.isArray(packageJson.files) || !packageJson.files.includes('dist') || !packageJson.files.includes('README.md') || !packageJson.files.includes('adapters') || !packageJson.files.includes('docs') || !packageJson.files.includes('examples')) {
  errors.push('package.json files must include dist, README.md, adapters, docs, and examples');
}

if (errors.length > 0) {
  console.error(JSON.stringify({ status: 'failed', errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    status: 'passed',
    runtimeExports: expectedRuntimeExports.length,
    typeExports: expectedTypeExports.length,
    schemas: expectedSchemas.length,
    scripts: expectedScripts.length,
  }, null, 2));
}
