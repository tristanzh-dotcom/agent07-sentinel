import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RunRuntimeOrchestratorInput,
  RuntimeAdapters,
  RuntimeCandidate,
  RuntimeCheckpoint,
  RuntimeConfig,
  RuntimeGates,
  RuntimeLogger,
  runRuntimeOrchestrator
} from "../../src/sentinel/runtimeOrchestrator.js";

let root: string;
let projectRoot: string;
let runtimeShadowRoot: string;
let runShadowDir: string;
let productionPipelinePath: string;
let logsDir: string;

const fixedNow = new Date("2026-06-16T07:30:00.000Z");

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function makeCandidate(index: number, overrides: Partial<RuntimeCandidate> = {}): RuntimeCandidate {
  return {
    id: `runtime-lead-${index}`,
    repo: `github/runtime/tool-${index}`,
    title: `Runtime Tool ${index}`,
    category: "advanced_ppt",
    readme: "# Runtime Tool\n\nRelative layout fixture for runtime tests.",
    qualityScore: 100 - index,
    artifact_urls: [`https://example.invalid/tool-${index}.png`],
    ...overrides
  };
}

function makeConfig(gates: Partial<RuntimeGates> = {}): RuntimeConfig {
  const mergedGates: RuntimeGates = {
    dry_run: true,
    live_network: false,
    live_model: false,
    live_publish: false,
    ...gates
  };

  return {
    version: 1,
    mode: mergedGates.live_publish ? "LIVE_PUBLISH" : mergedGates.live_network ? "LIVE_COLLECT" : "DRY_RUN",
    date: "2026-06-16",
    run_id: "runtime_20260616T073000Z",
    gates: mergedGates,
    paths: {
      project_root: projectRoot,
      runtime_shadow_root: runtimeShadowRoot,
      run_shadow_dir: runShadowDir,
      production_pipeline_path: productionPipelinePath,
      logs_dir: logsDir
    },
    limits: {
      max_candidates: 20,
      max_selected_leads: 5,
      max_single_payload_tokens: 10_000,
      max_daily_tokens: 50_000
    }
  };
}

function makeLogger(): RuntimeLogger & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    write: vi.fn(async (event) => {
      events.push(event);
    })
  };
}

function makeAdapters(candidates = [makeCandidate(1), makeCandidate(2), makeCandidate(3)]): RuntimeAdapters {
  return {
    mockSource: {
      fetchCandidates: vi.fn(async () => candidates)
    },
    liveSource: {
      fetchCandidates: vi.fn(async () => candidates)
    },
    mockModel: {
      invoke: vi.fn(async () => ({ provider: "mock", relevant: true }))
    },
    liveModel: {
      invoke: vi.fn(async () => ({ provider: "live", relevant: true }))
    },
    capturer: {
      captureLead: vi.fn(async (lead) => ({
        local_thumb_path: join(runShadowDir, "artifacts", lead.repo.replaceAll("/", "_"), "thumb.svg"),
        status: "CAPTURED" as const,
        errors: []
      }))
    },
    publisher: {
      atomicRename: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined)
    },
    logger: makeLogger()
  };
}

async function seedProductionPipeline() {
  await mkdir(join(projectRoot, "data"), { recursive: true });
  await writeFile(
    productionPipelinePath,
    `${JSON.stringify(
      {
        version: 1,
        run_id: "previous-production",
        updated_at: "2026-06-15T08:00:00.000Z",
        leads: [
          {
            id: "stable",
            repo: "github/stable/previous",
            title: "Stable Previous",
            status: "PENDING"
          }
        ],
        blacklist: {
          repos: [],
          authors: []
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function makeInput(overrides: Partial<RunRuntimeOrchestratorInput> = {}): RunRuntimeOrchestratorInput {
  const config = overrides.config ?? makeConfig();
  const adapters = overrides.adapters ?? makeAdapters();

  return {
    config,
    adapters,
    resume: true,
    staleLockTtlMs: 86_400_000,
    now: () => fixedNow,
    ...overrides
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-runtime-orchestrator-"));
  projectRoot = join(root, "Git-Scout");
  runtimeShadowRoot = join(projectRoot, "storage", "runtime_shadow");
  runShadowDir = join(runtimeShadowRoot, "runtime_20260616T073000Z");
  productionPipelinePath = join(projectRoot, "data", "scout_pipeline.json");
  logsDir = join(projectRoot, "storage", "logs");
  await mkdir(runShadowDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await seedProductionPipeline();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Production Runtime Orchestrator TDD contract", () => {
  it("defaults to dry-run gates and routes network/model work to mock adapters without live calls", async () => {
    const adapters = makeAdapters();

    const result = await runRuntimeOrchestrator(makeInput({ adapters }));

    expect(result.config.gates).toMatchObject({
      dry_run: true,
      live_network: false,
      live_model: false,
      live_publish: false
    });
    expect(result.routing).toMatchObject({
      source_adapter: "mock",
      model_adapter: "mock",
      publish_adapter: "shadow_only"
    });
    expect(adapters.liveSource.fetchCandidates).not.toHaveBeenCalled();
    expect(adapters.liveModel.invoke).not.toHaveBeenCalled();
    expect(adapters.mockSource.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(adapters.mockModel.invoke).toHaveBeenCalled();
  });

  it("keeps production scout_pipeline.json unchanged during shadow failure and publishes only after successful two-phase commit", async () => {
    const previousProductionJson = await readFile(productionPipelinePath, "utf8");
    const failingAdapters = makeAdapters();

    const failed = await runRuntimeOrchestrator(
      makeInput({
        adapters: failingAdapters,
        failureInjection: "after_blind_scout"
      })
    );

    expect(failed.status).toBe("FAILED_RECOVERABLE");
    expect(await readFile(productionPipelinePath, "utf8")).toBe(previousProductionJson);
    expect(await pathExists(failed.shadow_pipeline_path)).toBe(true);
    expect(failingAdapters.publisher.atomicRename).not.toHaveBeenCalled();

    const publishAdapters = makeAdapters();
    const published = await runRuntimeOrchestrator(
      makeInput({
        config: makeConfig({
          dry_run: false,
          live_network: true,
          live_model: true,
          live_publish: true
        }),
        adapters: publishAdapters
      })
    );

    expect(published.status).toBe("PUBLISHED");
    expect(published.published_pipeline_path).toBe(productionPipelinePath);
    expect(publishAdapters.publisher.atomicRename).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringContaining("scout_pipeline.shadow.json"),
        to: productionPipelinePath
      })
    );
  });

  it("self-heals stale shadow locks and resumes only the pending checkpoint steps", async () => {
    const staleLockPath = join(runShadowDir, "scout_pipeline.shadow.json.lock");
    const checkpointPath = join(runShadowDir, "checkpoint.json");
    await mkdir(staleLockPath, { recursive: true });

    const checkpoint: RuntimeCheckpoint = {
      version: 1,
      run_id: "runtime_20260616T073000Z",
      date: "2026-06-16",
      status: "RUNNING",
      created_at: "2026-06-15T07:30:00.000Z",
      updated_at: "2026-06-15T07:35:00.000Z",
      gates: {
        dry_run: true,
        live_network: false,
        live_model: false,
        live_publish: false
      },
      token_ledger: {
        estimated_input_tokens: 1200,
        estimated_output_tokens: 0,
        real_model_calls: 0,
        fixture_model_calls: 2
      },
      steps: [
        { step_id: "capture:tool-1", repo: "github/runtime/tool-1", status: "STEP_SUCCESS", attempts: 1 },
        { step_id: "capture:tool-2", repo: "github/runtime/tool-2", status: "STEP_SUCCESS", attempts: 1 },
        { step_id: "capture:tool-3", repo: "github/runtime/tool-3", status: "STEP_PENDING", attempts: 0 },
        { step_id: "capture:tool-4", repo: "github/runtime/tool-4", status: "STEP_PENDING", attempts: 0 },
        { step_id: "capture:tool-5", repo: "github/runtime/tool-5", status: "STEP_PENDING", attempts: 0 }
      ]
    };
    await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

    const adapters = makeAdapters([1, 2, 3, 4, 5].map((index) => makeCandidate(index)));

    const result = await runRuntimeOrchestrator(makeInput({ adapters }));

    expect(await pathExists(staleLockPath)).toBe(false);
    expect(result.resume.healed_locks).toContain(staleLockPath);
    expect(result.resume.skipped_steps.map((step) => step.repo)).toEqual(["github/runtime/tool-1", "github/runtime/tool-2"]);
    expect(result.resume.pending_steps.map((step) => step.repo)).toEqual([
      "github/runtime/tool-3",
      "github/runtime/tool-4",
      "github/runtime/tool-5"
    ]);
    expect(adapters.capturer.captureLead).toHaveBeenCalledTimes(3);
  });
});
