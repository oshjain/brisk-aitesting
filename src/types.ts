export type EngineType = 'ui' | 'api' | 'contract' | 'schema' | 'replay' | 'custom';
export type BriskAiTestingStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface AppConfig {
  readonly name: string;
  readonly baseUrl: string;
  readonly repoPath?: string;
  readonly env?: 'local' | 'ci' | 'staging' | 'production-like';
}

export type AuthConfig =
  | {
      readonly type: 'none';
    }
  | {
      readonly type: 'credentials';
      readonly loginUrl?: string;
      readonly username: string;
      readonly password: string;
    }
  | {
      readonly type: 'bearer';
      readonly token: string;
    }
  | {
      readonly type: 'custom';
      readonly description: string;
      readonly metadata?: Record<string, unknown>;
    };

export interface AiProviderConfig {
  readonly provider: 'openai' | 'openai-compatible' | 'deepseek' | 'minimax' | 'azure-openai' | 'anthropic' | 'local' | 'custom';
  readonly model: string;
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly endpoint?: string;
  readonly caCertPath?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly repairAttempts?: number;
}

export interface ContractConfig {
  readonly openApiPath?: string;
  readonly asyncApiPath?: string;
  readonly pactDir?: string;
}

export interface RuntimeConfig {
  readonly artifactsDir: string;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly headless: boolean;
  readonly dryRun: boolean;
}

export interface DiscoveryConfig {
  readonly includeRepo: boolean;
  readonly includeUi: boolean;
  readonly includeApi: boolean;
  readonly includeContracts: boolean;
}

export interface SecurityConfig {
  readonly networkPolicy: 'localhost-only' | 'allowlist' | 'open';
  readonly allowedHosts: readonly string[];
  readonly redactSecrets: boolean;
}

export interface BriskAiTestingConfig {
  readonly app: AppConfig;
  readonly auth: AuthConfig;
  readonly ai?: AiProviderConfig;
  readonly contracts?: ContractConfig;
  readonly runtime: RuntimeConfig;
  readonly discovery: DiscoveryConfig;
  readonly security: SecurityConfig;
  readonly engines?: readonly Engine[];
  readonly discoverer?: Discoverer;
  readonly validator?: PlanValidator;
  readonly aiProvider?: AiPlannerProvider;
}

export interface BriskAiTestingRunInput {
  readonly goal: string;
  readonly scenarios?: number;
  readonly mode?: 'automatic' | EngineType;
  readonly requiredTypes?: readonly EngineType[];
  readonly uiActionFeedback?: 'off' | 'when-missing' | 'always';
  readonly tags?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

export interface ScenarioPlan {
  readonly id: string;
  readonly name: string;
  readonly type: EngineType;
  readonly objective: string;
  readonly target?: {
    readonly method?: string;
    readonly path?: string;
    readonly route?: string;
    readonly schema?: string;
  };
  readonly request?: {
    readonly headers?: Record<string, string>;
    readonly query?: Record<string, string | number | boolean>;
    readonly body?: unknown;
  };
  readonly expect?: {
    readonly status?: number | readonly number[] | {
      readonly min?: number;
      readonly max?: number;
    };
    readonly json?: Record<string, unknown>;
    readonly contains?: string;
  };
  readonly assertions: readonly string[];
  readonly uiActions?: readonly UiActionPlan[];
  readonly evidenceRequired: readonly ('repo' | 'ui' | 'api' | 'schema' | 'auth')[];
  readonly metadata?: Record<string, unknown>;
}

export type UiActionPlan =
  | {
      readonly action: 'fill';
      readonly evidenceId: string;
      readonly value: string;
      readonly description?: string;
    }
  | {
      readonly action: 'click' | 'check';
      readonly evidenceId: string;
      readonly description?: string;
    }
  | {
      readonly action: 'select';
      readonly evidenceId: string;
      readonly value: string;
      readonly description?: string;
    }
  | {
      readonly action: 'press';
      readonly evidenceId: string;
      readonly key: string;
      readonly description?: string;
    }
  | {
      readonly action: 'assertText';
      readonly evidenceId: string;
      readonly text: string;
      readonly description?: string;
    };

export interface TestPlan {
  readonly schemaVersion: 'brisk-aitesting.plan.v1';
  readonly runId: string;
  readonly goal: string;
  readonly mode: 'automatic' | EngineType;
  readonly scenarios: readonly ScenarioPlan[];
  readonly discovery: DiscoveryResult;
  readonly warnings: readonly string[];
  readonly createdAt: string;
}

export interface DiscoveryRoute {
  readonly path: string;
  readonly source: 'config' | 'repo' | 'runtime' | 'contract';
  readonly confidence: number;
}

export interface DiscoveryApiRoute {
  readonly method: string;
  readonly path: string;
  readonly source: 'repo' | 'runtime' | 'contract' | 'config';
  readonly confidence: number;
  readonly operationId?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly contractPath?: string;
  readonly statusCodes?: readonly number[];
}

export interface DiscoveryContract {
  readonly kind: 'openapi' | 'asyncapi' | 'pact' | 'unknown';
  readonly path: string;
  readonly exists: boolean;
  readonly operations?: number;
  readonly errors?: readonly string[];
}

export interface ContractDriftRoute {
  readonly method: string;
  readonly path: string;
  readonly source?: DiscoveryApiRoute['source'];
  readonly confidence?: number;
  readonly operationId?: string;
  readonly contractPath?: string;
}

export interface ContractDriftReport {
  readonly schemaVersion: 'brisk-aitesting.contract-drift.v1';
  readonly kind: 'openapi';
  readonly contractPath?: string;
  readonly implementedRoutes: readonly ContractDriftRoute[];
  readonly documentedRoutes: readonly ContractDriftRoute[];
  readonly matchedRoutes: readonly {
    readonly method: string;
    readonly path: string;
    readonly implementation: ContractDriftRoute;
    readonly contract: ContractDriftRoute;
  }[];
  readonly implementedButUndocumented: readonly ContractDriftRoute[];
  readonly documentedButNotImplemented: readonly ContractDriftRoute[];
  readonly diagnostics: readonly string[];
}

export interface OpenApiOperationSummary {
  readonly method: string;
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly statusCodes: readonly number[];
  readonly requestBodyRequired: boolean;
  readonly requestContentTypes: readonly string[];
  readonly requestSchema?: unknown;
  readonly requestExample?: unknown;
  readonly invalidRequestExample?: unknown;
  readonly responseContentTypes: readonly string[];
  readonly responseSchemas: readonly OpenApiResponseSummary[];
}

export interface OpenApiResponseSummary {
  readonly statusCode: number;
  readonly contentType?: string;
  readonly schema?: unknown;
}

export interface OpenApiDocumentSummary {
  readonly schemaVersion: 'brisk-aitesting.openapi-summary.v1';
  readonly path: string;
  readonly format: 'json' | 'yaml';
  readonly title?: string;
  readonly version?: string;
  readonly openapiVersion?: string;
  readonly operations: readonly OpenApiOperationSummary[];
  readonly diagnostics: readonly string[];
}

export interface DiscoveryResult {
  readonly schemaVersion: 'brisk-aitesting.discovery.v1';
  readonly app: Pick<AppConfig, 'name' | 'baseUrl' | 'repoPath'>;
  readonly uiRoutes: readonly DiscoveryRoute[];
  readonly apiRoutes: readonly DiscoveryApiRoute[];
  readonly contracts: readonly DiscoveryContract[];
  readonly contractDrift?: ContractDriftReport;
  readonly repoSignals: readonly {
    readonly kind: 'framework' | 'package' | 'test-runner' | 'source-file';
    readonly value: string;
    readonly source: string;
  }[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
}

export interface ArtifactRef {
  readonly kind: 'json' | 'junit' | 'html' | 'trace' | 'screenshot' | 'video' | 'test-file' | 'log' | 'other';
  readonly path?: string;
  readonly url?: string;
  readonly label: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UiElementEvidence {
  readonly id: string;
  readonly kind: 'role' | 'label' | 'text' | 'testId' | 'css';
  readonly role?: string;
  readonly label?: string;
  readonly text?: string;
  readonly testId?: string;
  readonly css?: string;
  readonly tagName: string;
  readonly inputType?: string;
  readonly locator: {
    readonly strategy: 'role' | 'label' | 'text' | 'testId' | 'css';
    readonly value: string;
  };
  readonly confidence: number;
}

export interface UiGroundingEvidence {
  readonly schemaVersion: 'brisk-aitesting.ui-grounding.v1';
  readonly scenario: {
    readonly id: string;
    readonly name: string;
    readonly objective: string;
  };
  readonly route: string;
  readonly url: string;
  readonly title: string;
  readonly capturedAt: string;
  readonly elements: readonly UiElementEvidence[];
  readonly summary: {
    readonly total: number;
    readonly roles: Record<string, number>;
    readonly labels: number;
    readonly testIds: number;
    readonly actionable: number;
  };
}

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly name: string;
  readonly type: EngineType;
  readonly engine: string;
  readonly status: BriskAiTestingStatus;
  readonly durationMs: number;
  readonly assertions: readonly {
    readonly name: string;
    readonly status: BriskAiTestingStatus;
    readonly message?: string;
  }[];
  readonly artifacts: readonly ArtifactRef[];
  readonly diagnostics: readonly string[];
}

export interface BriskAiTestingResult {
  readonly schemaVersion: 'brisk-aitesting.result.v1';
  readonly runId: string;
  readonly status: BriskAiTestingStatus;
  readonly app: Pick<AppConfig, 'name' | 'baseUrl' | 'env'>;
  readonly goal: string;
  readonly discovery: DiscoveryResult;
  readonly plan: TestPlan;
  readonly summary: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly errors: number;
    readonly passRate: number;
    readonly durationMs: number;
  };
  readonly tests: readonly ScenarioResult[];
  readonly artifacts: readonly ArtifactRef[];
  readonly diagnosis: readonly {
    readonly scenarioId?: string;
    readonly reason: string;
    readonly suggestedFixes: readonly string[];
  }[];
  readonly handover: HandoverEnvelope;
}

export interface HandoverEnvelope {
  readonly schemaVersion: 'brisk-aitesting.handover.v1';
  readonly generatedAt: string;
  readonly resultSchema: 'brisk-aitesting.result.v1';
  readonly storage: {
    readonly required: false;
    readonly recommendedKeys: readonly string[];
    readonly artifactRoot: string;
  };
  readonly consumers: {
    readonly database: 'store result JSON as-is or split summary/tests/artifacts';
    readonly ci: 'use status, summary, artifacts, and junit/html outputs';
    readonly dashboard: 'render summary, tests, artifacts, and diagnosis';
  };
}

export interface PlannerContext {
  readonly config: BriskAiTestingConfig;
  readonly input: BriskAiTestingRunInput;
  readonly runId: string;
  readonly discovery: DiscoveryResult;
}

export interface PlannerRepairContext extends PlannerContext {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly invalidPlan: TestPlan;
  readonly validation: ValidationResult;
}

export interface UiActionEnrichmentContext extends PlannerContext {
  readonly scenario: ScenarioPlan;
  readonly grounding: UiGroundingEvidence;
}

export interface DiscovererContext {
  readonly config: BriskAiTestingConfig;
  readonly input: BriskAiTestingRunInput;
  readonly runId: string;
}

export interface Discoverer {
  readonly name: string;
  discover(context: DiscovererContext): Promise<DiscoveryResult>;
}

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly schemaVersion: 'brisk-aitesting.validation.v1';
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface PlanValidatorContext {
  readonly config: BriskAiTestingConfig;
  readonly input: BriskAiTestingRunInput;
  readonly plan: TestPlan;
}

export interface PlanValidator {
  readonly name: string;
  validate(context: PlanValidatorContext): Promise<ValidationResult> | ValidationResult;
}

export interface Planner {
  readonly name: string;
  plan(context: PlannerContext): Promise<TestPlan>;
  repair?(context: PlannerRepairContext): Promise<TestPlan>;
  enrichUiActions?(context: UiActionEnrichmentContext): Promise<readonly UiActionPlan[]>;
}

export interface UiRouteGrounderContext {
  readonly config: BriskAiTestingConfig;
  readonly runId: string;
  readonly scenario: ScenarioPlan;
}

export interface UiRouteGrounderResult {
  readonly grounding: UiGroundingEvidence;
  readonly artifacts: readonly ArtifactRef[];
}

export interface UiRouteGrounder {
  readonly name: string;
  ground(context: UiRouteGrounderContext): Promise<UiRouteGrounderResult>;
}

export interface AiPlannerProviderRequest {
  readonly system: string;
  readonly user: string;
  readonly jsonSchemaName: 'brisk-aitesting.plan.v1';
}

export interface AiPlannerProviderResponse {
  readonly content: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
}

export interface AiPlannerProvider {
  readonly name: string;
  complete(request: AiPlannerProviderRequest): Promise<AiPlannerProviderResponse>;
}

export interface EngineContext {
  readonly config: BriskAiTestingConfig;
  readonly runId: string;
  readonly plan: TestPlan;
  readonly scenario: ScenarioPlan;
}

export interface EngineRunResult {
  readonly result: ScenarioResult;
  readonly artifacts?: readonly ArtifactRef[];
}

export interface Engine {
  readonly name: string;
  readonly type: EngineType;
  canRun(scenario: ScenarioPlan): boolean;
  run(context: EngineContext): Promise<EngineRunResult>;
}

export type BriskAiTestingEvent =
  | { readonly type: 'run.started'; readonly runId: string; readonly goal: string }
  | { readonly type: 'discovery.completed'; readonly runId: string; readonly discovery: DiscoveryResult }
  | { readonly type: 'plan.created'; readonly runId: string; readonly plan: TestPlan }
  | { readonly type: 'plan.validated'; readonly runId: string; readonly validation: ValidationResult }
  | { readonly type: 'plan.repair.started'; readonly runId: string; readonly attempt: number; readonly validation: ValidationResult }
  | { readonly type: 'plan.repaired'; readonly runId: string; readonly attempt: number; readonly plan: TestPlan }
  | { readonly type: 'plan.enriched'; readonly runId: string; readonly plan: TestPlan }
  | { readonly type: 'ui.grounding.completed'; readonly runId: string; readonly scenario: ScenarioPlan; readonly grounding: UiGroundingEvidence }
  | { readonly type: 'ui.actions.enriched'; readonly runId: string; readonly scenario: ScenarioPlan; readonly actions: readonly UiActionPlan[] }
  | { readonly type: 'scenario.started'; readonly runId: string; readonly scenario: ScenarioPlan }
  | { readonly type: 'scenario.completed'; readonly runId: string; readonly result: ScenarioResult }
  | { readonly type: 'run.completed'; readonly runId: string; readonly result: BriskAiTestingResult };
