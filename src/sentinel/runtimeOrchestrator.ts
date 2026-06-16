import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { ArtifactHintGuardResult } from "./artifactHintGuard.js";

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

export type RuntimeShadowEvidenceEntry = {
  repo: string;
  status: "LOW_QUALITY_FILTERED";
  source: "artifact_hint_guard";
  captured_at: string;
  evidence: ArtifactHintGuardResult;
};

export type RuntimeShadowEvidence = Record<string, RuntimeShadowEvidenceEntry>;

export type RuntimePipelineState = {
  version: 1;
  run_id: string;
  run_label: "[RUNTIME_DRY_RUN]" | "[RUNTIME_LIVE]";
  updated_at: string;
  leads: RuntimePipelineLead[];
  shadow_evidence?: RuntimeShadowEvidence;
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
  fetchCandidates: () => Promise<RuntimeCandidate[] | { candidates: RuntimeCandidate[]; shadow_evidence?: RuntimeShadowEvidence }>;
  fetchShadowEvidence?: () => Promise<RuntimeShadowEvidence> | RuntimeShadowEvidence;
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

function iso(input: RunRuntimeOrchestratorInput) {
  return input.now().toISOString();
}

function shadowPipelinePath(config: RuntimeConfig) {
  return join(config.paths.run_shadow_dir, "scout_pipeline.shadow.json");
}

function checkpointPath(config: RuntimeConfig) {
  return join(config.paths.run_shadow_dir, "checkpoint.json");
}

function shadowArtifactRoot(config: RuntimeConfig) {
  return join(config.paths.run_shadow_dir, "artifacts");
}

async function fsyncPath(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fsyncPath(tmpPath);
    await rename(tmpPath, path);
    await fsyncPath(dirname(path));
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

async function readCheckpoint(path: string): Promise<RuntimeCheckpoint | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RuntimeCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function healStaleLocks(config: RuntimeConfig): Promise<string[]> {
  await mkdir(config.paths.run_shadow_dir, { recursive: true });
  const names = await readdir(config.paths.run_shadow_dir).catch(() => []);
  const healed: string[] = [];

  for (const name of names) {
    if (!name.endsWith(".lock")) continue;
    const path = join(config.paths.run_shadow_dir, name);
    const entry = await stat(path).catch(() => null);
    if (!entry?.isDirectory()) continue;
    await rm(path, { recursive: true, force: true });
    healed.push(path);
  }

  return healed;
}

function successfulSteps(checkpoint: RuntimeCheckpoint | null) {
  return checkpoint?.steps.filter((step) => step.status === "STEP_SUCCESS") ?? [];
}

function pendingSteps(checkpoint: RuntimeCheckpoint | null) {
  return checkpoint?.steps.filter((step) => step.status === "STEP_PENDING" || step.status === "STEP_FAILED_RETRYABLE") ?? [];
}

function tokenLedger(checkpoint: RuntimeCheckpoint | null): RuntimeCheckpoint["token_ledger"] {
  return (
    checkpoint?.token_ledger ?? {
      estimated_input_tokens: 0,
      estimated_output_tokens: 0,
      real_model_calls: 0,
      fixture_model_calls: 0
    }
  );
}

function shouldSkipCandidate(candidate: RuntimeCandidate, skipped: RuntimeCheckpointStep[]) {
  return skipped.some((step) => step.repo === candidate.repo);
}

function pipelineFrom(
  leads: RuntimePipelineLead[],
  config: RuntimeConfig,
  updatedAt: string,
  shadowEvidence: RuntimeShadowEvidence = {}
): RuntimePipelineState {
  const pipeline: RuntimePipelineState = {
    version: 1,
    run_id: config.run_id,
    run_label: config.gates.live_publish ? "[RUNTIME_LIVE]" : "[RUNTIME_DRY_RUN]",
    updated_at: updatedAt,
    leads,
    blacklist: {
      repos: [],
      authors: []
    }
  };
  if (Object.keys(shadowEvidence).length > 0) {
    pipeline.shadow_evidence = shadowEvidence;
  }
  return pipeline;
}

async function log(input: RunRuntimeOrchestratorInput, event: string, context: Record<string, unknown> = {}) {
  await input.adapters.logger.write({
    level: "INFO",
    component: "runtime",
    event,
    context: {
      run_id: input.config.run_id,
      date: input.config.date,
      ...context
    }
  });
}

function emptyResume(): RuntimeRunResult["resume"] {
  return {
    healed_locks: [],
    skipped_steps: [],
    pending_steps: []
  };
}

function routingFor(config: RuntimeConfig): RuntimeRunResult["routing"] {
  return {
    source_adapter: config.gates.live_network ? "live" : "mock",
    model_adapter: config.gates.live_model ? "live" : "mock",
    publish_adapter: config.gates.live_publish && !config.gates.dry_run ? "live_publish" : "shadow_only"
  };
}

async function fetchSourcePayload(source: RuntimeSourceClient) {
  const payload = await source.fetchCandidates();
  if (Array.isArray(payload)) {
    return {
      candidates: payload,
      shadowEvidence: source.fetchShadowEvidence ? await source.fetchShadowEvidence() : {}
    };
  }
  return {
    candidates: payload.candidates,
    shadowEvidence: payload.shadow_evidence ?? (source.fetchShadowEvidence ? await source.fetchShadowEvidence() : {})
  };
}

export async function runRuntimeOrchestrator(input: RunRuntimeOrchestratorInput): Promise<RuntimeRunResult> {
  const startedAt = iso(input);
  const config = input.config;
  const routing = routingFor(config);
  const shadowPath = shadowPipelinePath(config);
  const resume = emptyResume();

  await mkdir(config.paths.run_shadow_dir, { recursive: true });
  await log(input, "RUNTIME_STARTED", { gates: config.gates });

  resume.healed_locks = await healStaleLocks(config);
  const checkpoint = input.resume ? await readCheckpoint(checkpointPath(config)) : null;
  resume.skipped_steps = successfulSteps(checkpoint);
  resume.pending_steps = pendingSteps(checkpoint);

  if (resume.healed_locks.length > 0 || resume.skipped_steps.length > 0) {
    await log(input, "CHECKPOINT_RESUME", {
      healed_locks: resume.healed_locks,
      skipped_steps: resume.skipped_steps.length
    });
  }

  const source = config.gates.live_network ? input.adapters.liveSource : input.adapters.mockSource;
  const model = config.gates.live_model ? input.adapters.liveModel : input.adapters.mockModel;
  const sourcePayload = await fetchSourcePayload(source);
  const candidates = sourcePayload.candidates
    .slice(0, config.limits.max_candidates)
    .sort((left, right) => right.qualityScore - left.qualityScore)
    .slice(0, config.limits.max_selected_leads);
  const shadowEvidence = sourcePayload.shadowEvidence;

  const ledger = tokenLedger(checkpoint);
  const leads: RuntimePipelineLead[] = candidates.map((candidate) => ({
    id: candidate.id,
    repo: candidate.repo,
    title: candidate.title,
    status: "PENDING",
    artifacts: {
      local_thumb_path: "",
      status: "PENDING",
      errors: []
    }
  }));
  const pipeline = pipelineFrom(leads, config, iso(input), shadowEvidence);
  await writeJsonAtomic(shadowPath, pipeline);

  if (input.failureInjection === "after_blind_scout") {
    await log(input, "RUNTIME_COMPLETED", { status: "FAILED_RECOVERABLE" });
    return {
      version: 1,
      run_id: config.run_id,
      date: config.date,
      status: "FAILED_RECOVERABLE",
      config,
      started_at: startedAt,
      completed_at: iso(input),
      shadow_pipeline_path: shadowPath,
      published_pipeline_path: null,
      pipeline,
      token_ledger: ledger,
      resume,
      routing,
      warnings: ["after_blind_scout"]
    };
  }

  const capturedLeads: RuntimePipelineLead[] = [];
  for (const candidate of candidates) {
    const existing = leads.find((lead) => lead.repo === candidate.repo)!;
    if (shouldSkipCandidate(candidate, resume.skipped_steps)) {
      capturedLeads.push({
        ...existing,
        status: "CAPTURED",
        artifacts: {
          local_thumb_path: join(shadowArtifactRoot(config), candidate.repo.replaceAll("/", "_"), "thumb.svg"),
          status: "CAPTURED",
          errors: []
        }
      });
      continue;
    }

    await model.invoke(candidate.readme);
    if (config.gates.live_model) {
      ledger.real_model_calls += 1;
    } else {
      ledger.fixture_model_calls += 1;
    }

    const artifacts = await input.adapters.capturer.captureLead(candidate, {
      shadowArtifactRoot: shadowArtifactRoot(config)
    });
    capturedLeads.push({
      ...existing,
      status: "CAPTURED",
      artifacts
    });
  }

  const capturedPipeline = pipelineFrom(capturedLeads, config, iso(input), shadowEvidence);
  await writeJsonAtomic(shadowPath, capturedPipeline);

  let status: RuntimeRunStatus = config.gates.live_publish && !config.gates.dry_run ? "PUBLISHED" : "DRY_RUN_COMPLETED";
  let publishedPath: string | null = null;

  if (status === "PUBLISHED") {
    await input.adapters.publisher.atomicRename({
      from: shadowPath,
      to: config.paths.production_pipeline_path
    });
    publishedPath = config.paths.production_pipeline_path;
    await log(input, "PUBLISH_COMMIT", { target: publishedPath });
  }

  await log(input, "RUNTIME_COMPLETED", { status });

  return {
    version: 1,
    run_id: config.run_id,
    date: config.date,
    status,
    config,
    started_at: startedAt,
    completed_at: iso(input),
    shadow_pipeline_path: shadowPath,
    published_pipeline_path: publishedPath,
    pipeline: capturedPipeline,
    token_ledger: ledger,
    resume,
    routing,
    warnings: []
  };
}
