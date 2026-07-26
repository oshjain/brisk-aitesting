import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);
const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
const readme = await readFile(join(packageDir, 'README.md'), 'utf8');
const architecture = await readFile(join(packageDir, 'docs', 'ARCHITECTURE.md'), 'utf8');
const types = await readFile(join(packageDir, 'dist', 'types.d.ts'), 'utf8');
const indexTypes = await readFile(join(packageDir, 'dist', 'index.d.ts'), 'utf8');

const expectedRuntimeExports = [
  'AiPlanner',
  'BriskAiTesting',
  'BriskAiTestingProviderError',
  'BuiltinApiEngine',
  'BuiltinContractEngine',
  'BuiltinDiscoverer',
  'BuiltinPlanner',
  'BuiltinPlanValidator',
  'BuiltinPlaywrightEngine',
  'BuiltinPlaywrightRouteGrounder',
  'OpenAiCompatibleProvider',
  'createInvalidSchemaExample',
  'createAiProviderFromConfig',
  'createBriskAiTesting',
  'createSchemaExample',
  'defineConfig',
  'defineConfigFromHost',
  'loadConfig',
  'loadEnvFiles',
  'loadOpenApiSummary',
  'mergeConfig',
  'openApiOperationsToDiscoveryRoutes',
  'normalizeConfig',
  'parseAiPlanForTesting',
  'summarizeOpenApiDocument',
  'validateJsonSchema',
];

const expectedTypeExports = [
  'AiPlannerProvider',
  'ArtifactRef',
  'BriskAiTestingConfig',
  'BriskAiTestingEvent',
  'BriskAiTestingResult',
  'BriskAiTestingRunInput',
  'Engine',
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
];

const expectedSchemas = [
  'brisk-aitesting.plan.v1',
  'brisk-aitesting.validation.v1',
  'brisk-aitesting.discovery.v1',
  'brisk-aitesting.result.v1',
  'brisk-aitesting.handover.v1',
  'brisk-aitesting.cli-result.v1',
  'brisk-aitesting.api-evidence.v1',
  'brisk-aitesting.openapi-summary.v1',
  'brisk-aitesting.playwright-evidence.v1',
  'brisk-aitesting.ui-grounding.v1',
  'brisk-aitesting.ui-actions.v1',
];

const expectedScripts = [
  'build',
  'typecheck',
  'smoke',
  'smoke:contracts',
  'smoke:cli',
  'smoke:ai-fixtures',
  'smoke:real-ai',
  'smoke:all',
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
}

for (const script of expectedScripts) {
  if (typeof packageJson.scripts?.[script] !== 'string') errors.push(`package.json missing script ${script}`);
}

if (!Array.isArray(packageJson.files) || !packageJson.files.includes('dist') || !packageJson.files.includes('README.md') || !packageJson.files.includes('docs')) {
  errors.push('package.json files must include dist, README.md, and docs');
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
