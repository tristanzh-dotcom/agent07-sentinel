import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  request: Agent07RuntimeTriggerRequest,
  deps: Agent07RuntimeControllerDeps
): Promise<Agent07RuntimeTriggerResponse> {
  if (deps.mutex.active_run_id) {
    return {
      version: 1,
      ok: false,
      http_status: 409,
      run_id: deps.mutex.active_run_id,
      status: "ORCHESTRATOR_BUSY",
      status_url: "/api/agent07/runtime/status"
    };
  }

  const runId = runIdFrom(deps.now());
  deps.mutex.active_run_id = runId;

  const safeConfig: Agent07RuntimeSafeTriggerConfig = {
    run_id: runId,
    date: request.date,
    gates: {
      dry_run: true,
      live_network: true,
      live_model: false,
      live_publish: false
    }
  };

  let runtimePromise: Promise<Agent07RuntimeRunResult>;
  try {
    runtimePromise = deps.invokeRuntime(safeConfig);
  } catch (error) {
    runtimePromise = Promise.reject(error);
  }

  void runtimePromise
    .catch(() => undefined)
    .finally(() => {
      if (deps.mutex.active_run_id === runId) {
        deps.mutex.active_run_id = null;
      }
    });

  return {
    version: 1,
    ok: true,
    http_status: 202,
    run_id: runId,
    status: "STARTING",
    status_url: "/api/agent07/runtime/status"
  };
}

export async function readAgent07RuntimeShadowSummary(
  input: Agent07RuntimeShadowSummaryInput
): Promise<Agent07RuntimeShadowSummary> {
  const warnings: string[] = [];
  const shadow = await readOptionalJson(join(input.run_shadow_dir, "scout_pipeline.shadow.json"), warnings);
  const queryCheckpoint = await readOptionalJson(join(input.run_shadow_dir, "source_query_checkpoint.json"), warnings);

  const leads = arrayFrom((shadow as { leads?: unknown[] } | null)?.leads).map((lead) => {
    const record = objectFrom(lead);
    const promotion = objectFrom(record.promotion);
    return {
      repo: stringFrom(record.repo),
      title: stringFrom(record.title),
      status: stringFrom(record.status),
      relevance_score: numberOrUndefined(promotion.relevance_score),
      matched_tags: uniqueStrings([
        ...arrayFrom(promotion.matched_tags),
        ...arrayFrom(promotion.matched_positive_terms),
        ...arrayFrom(promotion.matched_negative_terms)
      ])
    };
  });

  const shadowEvidenceRecords = Object.values(objectFrom((shadow as { shadow_evidence?: unknown } | null)?.shadow_evidence));
  const shadowEvidence = shadowEvidenceRecords.map((entry) => {
    const record = objectFrom(entry);
    const evidence = objectFrom(record.evidence);
    return {
      repo: stringFrom(record.repo),
      status: "LOW_QUALITY_FILTERED" as const,
      reasons: uniqueStrings([
        ...arrayFrom(evidence.reason_codes),
        ...arrayFrom(evidence.reasons),
        ...arrayFrom(evidence.matched_terms),
        ...arrayFrom(evidence.matched_blacklist_terms)
      ])
    };
  });

  const overflowRecords = Object.values(objectFrom((shadow as { low_relevance_overflow?: unknown } | null)?.low_relevance_overflow));
  const lowRelevanceOverflow = overflowRecords.map((entry) => {
    const record = objectFrom(entry);
    const evidence = objectFrom(record.evidence);
    return {
      repo: stringFrom(record.repo),
      status: "LOW_RELEVANCE_OVERFLOW" as const,
      relevance_score: numberOrUndefined(evidence.relevance_score) ?? 0,
      matched_tags: uniqueStrings([
        ...arrayFrom(evidence.matched_tags),
        ...arrayFrom(evidence.matched_positive_terms),
        ...arrayFrom(evidence.matched_negative_terms),
        ...arrayFrom(evidence.promote_reason_codes),
        ...arrayFrom(evidence.demote_reason_codes)
      ])
    };
  });

  const readmeSkipRecords = Object.values(objectFrom((shadow as { readme_skip_evidence?: unknown } | null)?.readme_skip_evidence));
  const readmeSkipEvidence = readmeSkipRecords.map((entry) => {
    const record = objectFrom(entry);
    const evidence = objectFrom(record.evidence);
    return {
      repo: stringFrom(record.repo),
      status: readmeSkipStatus(record.status),
      requested_sleep_ms: numberOrUndefined(evidence.requested_sleep_ms),
      reason: stringOrUndefined(evidence.reason)
    };
  });

  return {
    version: 1,
    run_id: input.run_id,
    low_quality_filtered_count: shadowEvidence.length,
    low_relevance_overflow_count: lowRelevanceOverflow.length,
    readme_skip_count: readmeSkipEvidence.length,
    query_timeout_skipped_count: countQueryTimeoutSkipped(queryCheckpoint),
    leads,
    shadow_evidence: shadowEvidence,
    low_relevance_overflow: lowRelevanceOverflow,
    readme_skip_evidence: readmeSkipEvidence,
    warnings
  };
}

function runIdFrom(now: Date) {
  return `runtime_${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

async function readOptionalJson(path: string, warnings: string[]): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      warnings.push(`missing:${path}`);
      return null;
    }
    throw error;
  }
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringFrom(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function readmeSkipStatus(value: unknown): Agent07RuntimeShadowSummary["readme_skip_evidence"][number]["status"] {
  if (value === "README_RATE_LIMIT_EXCEEDED" || value === "GLOBAL_BUDGET_EXHAUSTED") return value;
  return "README_RATE_LIMIT_SKIPPED";
}

function countQueryTimeoutSkipped(value: unknown): number {
  const checkpoint = objectFrom(value);
  return arrayFrom(checkpoint.batches).filter((batch) => objectFrom(batch).status === "QUERY_TIMEOUT_SKIPPED").length;
}
