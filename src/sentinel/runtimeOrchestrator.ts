export class RuntimeOrchestratorNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "RuntimeOrchestratorNotImplementedError";
  }
}

export type RuntimeMode = "DRY_RUN" | "LIVE_COLLECT" | "LIVE_PUBLISH";
export type RuntimeRunStatus =
  | "DRY_RUN_COMPLETED"
  | "PUBLISHED"
  | "FAILED_RECOVERABLE"
  | "FAILED_TERMINAL"
  | "BLOCKED_BY_GATE"
  | "BLOCKED_BY_TOKEN_BUDGET";

export type RuntimeGates = {
  dry_run: boolean;
  live_network: boolean;
  live_model: boolean;
  live_publish: boolean;
};

export type RuntimeConfig = {
  version: 1;
  mode: RuntimeMode;
  date: string;
  run_id: string;
  gates: RuntimeGates;
  paths: {
    project_root: string;
    runtime_shadow_root: string;
    run_shadow_dir: string;
    production_pipeline_path: string;
    logs_dir: string;
  };
  limits: {
    max_candidates: number;
    max_selected_leads: 5;
    max_single_payload_tokens: number;
    max_daily_tokens: number;
  };
};

export type RuntimeCandidate = {
  id: string;
  repo: string;
  title: string;
  category: string;
  readme: string;
  qualityScore: number;
  artifact_urls: string[];
};

export type RuntimePipelineLead = {
  id: string;
  repo: string;
  title: string;
  status: "PENDING" | "CAPTURED" | "PUBLISHED";
  artifacts: {
    local_thumb_path: string;
    status: "PENDING" | "CAPTURED" | "FALLBACK_USED";
    errors: Array<{ code: string; message: string }>;
  };
};

export type RuntimePipelineState = {
  version: 1;
  run_id: string;
  run_label: "[RUNTIME_DRY_RUN]" | "[RUNTIME_LIVE]";
  updated_at: string;
  leads: RuntimePipelineLead[];
  blacklist: {
    repos: string[];
    authors: string[];
  };
};

export type RuntimeStepStatus =
  | "STEP_PENDING"
  | "STEP_RUNNING"
  | "STEP_RETRYING"
  | "STEP_SUCCESS"
  | "STEP_FAILED_RETRYABLE"
  | "STEP_FAILED_TERMINAL"
  | "STEP_SKIPPED_RESUME";

export type RuntimeCheckpointStep = {
  step_id: string;
  repo?: string;
  status: RuntimeStepStatus;
  attempts: number;
  started_at?: string;
  completed_at?: string;
  idempotency_key?: string;
};

export type RuntimeCheckpoint = {
  version: 1;
  run_id: string;
  date: string;
  status: "PENDING" | "RUNNING" | "PAUSED" | "FAILED" | "READY_TO_PUBLISH" | "PUBLISHED" | "DRY_RUN_COMPLETED";
  created_at: string;
  updated_at: string;
  gates: RuntimeGates;
  token_ledger: {
    estimated_input_tokens: number;
    estimated_output_tokens: number;
    real_model_calls: number;
    fixture_model_calls: number;
  };
  steps: RuntimeCheckpointStep[];
};

export type RuntimeSourceClient = {
  fetchCandidates: () => Promise<RuntimeCandidate[]>;
};

export type RuntimeModelClient = {
  invoke: (payload: string) => Promise<unknown>;
};

export type RuntimeCapturer = {
  captureLead: (lead: RuntimeCandidate, context: { shadowArtifactRoot: string }) => Promise<{
    local_thumb_path: string;
    status: "CAPTURED" | "FALLBACK_USED";
    errors: Array<{ code: string; message: string }>;
  }>;
};

export type RuntimePublisher = {
  atomicRename: (input: { from: string; to: string }) => Promise<void>;
  publish: (input: { shadowPipelinePath: string; productionPipelinePath: string }) => Promise<void>;
};

export type RuntimeLogger = {
  write: (event: {
    level: "DEBUG" | "INFO" | "WARN" | "ERROR";
    component: string;
    event: string;
    context: Record<string, unknown>;
  }) => Promise<void>;
};

export type RuntimeAdapters = {
  mockSource: RuntimeSourceClient;
  liveSource: RuntimeSourceClient;
  mockModel: RuntimeModelClient;
  liveModel: RuntimeModelClient;
  capturer: RuntimeCapturer;
  publisher: RuntimePublisher;
  logger: RuntimeLogger;
};

export type RuntimeFailureInjection = "after_blind_scout" | "before_publish_rename";

export type RunRuntimeOrchestratorInput = {
  config: RuntimeConfig;
  adapters: RuntimeAdapters;
  resume: boolean;
  staleLockTtlMs: number;
  now: () => Date;
  failureInjection?: RuntimeFailureInjection;
};

export type RuntimeRunResult = {
  version: 1;
  run_id: string;
  date: string;
  status: RuntimeRunStatus;
  config: RuntimeConfig;
  started_at: string;
  completed_at: string;
  shadow_pipeline_path: string;
  published_pipeline_path: string | null;
  pipeline?: RuntimePipelineState;
  token_ledger: RuntimeCheckpoint["token_ledger"];
  resume: {
    healed_locks: string[];
    skipped_steps: RuntimeCheckpointStep[];
    pending_steps: RuntimeCheckpointStep[];
  };
  routing: {
    source_adapter: "mock" | "live";
    model_adapter: "mock" | "live";
    publish_adapter: "shadow_only" | "live_publish";
  };
  warnings: string[];
};

export async function runRuntimeOrchestrator(_input: RunRuntimeOrchestratorInput): Promise<RuntimeRunResult> {
  throw new RuntimeOrchestratorNotImplementedError("runRuntimeOrchestrator");
}
