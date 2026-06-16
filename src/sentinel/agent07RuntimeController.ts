export class Agent07RuntimeControllerNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "Agent07RuntimeControllerNotImplementedError";
  }
}

export type Agent07RuntimeTriggerMode = "LIVE_NETWORK_SHADOW_PROBE";

export type Agent07RuntimeTriggerRequest = {
  mode: Agent07RuntimeTriggerMode;
  date: string;
  live_network?: boolean;
  live_model?: boolean;
  live_publish?: boolean;
};

export type Agent07RuntimeSafeTriggerConfig = {
  run_id: string;
  date: string;
  gates: {
    dry_run: true;
    live_network: true;
    live_model: false;
    live_publish: false;
  };
};

export type Agent07RuntimeRunResult = {
  version: 1;
  run_id: string;
  date: string;
  status: "DRY_RUN_COMPLETED" | "FAILED_RECOVERABLE" | "FAILED_TERMINAL";
  shadow_pipeline_path: string;
  published_pipeline_path: string | null;
  warnings: string[];
};

export type Agent07RuntimeMutex = {
  active_run_id: string | null;
};

export type Agent07RuntimeControllerDeps = {
  mutex: Agent07RuntimeMutex;
  now: () => Date;
  production_pipeline_path?: string;
  invokeRuntime: (config: Agent07RuntimeSafeTriggerConfig) => Promise<Agent07RuntimeRunResult>;
};

export type Agent07RuntimeTriggerResponse = {
  version: 1;
  ok: boolean;
  http_status: 202 | 409;
  run_id: string;
  status: "STARTING" | "ORCHESTRATOR_BUSY";
  status_url: "/api/agent07/runtime/status";
};

export type Agent07RuntimeShadowSummaryInput = {
  run_id: string;
  run_shadow_dir: string;
};

export type Agent07RuntimeShadowSummary = {
  version: 1;
  run_id: string;
  low_quality_filtered_count: number;
  low_relevance_overflow_count: number;
  readme_skip_count: number;
  query_timeout_skipped_count: number;
  leads: Array<{
    repo: string;
    title: string;
    status: string;
    relevance_score?: number;
    matched_tags?: string[];
  }>;
  shadow_evidence: Array<{
    repo: string;
    status: "LOW_QUALITY_FILTERED";
    reasons: string[];
  }>;
  low_relevance_overflow: Array<{
    repo: string;
    status: "LOW_RELEVANCE_OVERFLOW";
    relevance_score: number;
    matched_tags: string[];
  }>;
  readme_skip_evidence: Array<{
    repo: string;
    status: "README_RATE_LIMIT_SKIPPED" | "README_RATE_LIMIT_EXCEEDED" | "GLOBAL_BUDGET_EXHAUSTED";
    requested_sleep_ms?: number;
    reason?: string;
  }>;
  warnings: string[];
};

export async function handleAgent07RuntimeTrigger(
  _request: Agent07RuntimeTriggerRequest,
  _deps: Agent07RuntimeControllerDeps
): Promise<Agent07RuntimeTriggerResponse> {
  throw new Agent07RuntimeControllerNotImplementedError("handleAgent07RuntimeTrigger");
}

export async function readAgent07RuntimeShadowSummary(
  _input: Agent07RuntimeShadowSummaryInput
): Promise<Agent07RuntimeShadowSummary> {
  throw new Agent07RuntimeControllerNotImplementedError("readAgent07RuntimeShadowSummary");
}
