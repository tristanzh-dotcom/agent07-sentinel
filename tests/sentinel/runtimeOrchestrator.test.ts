import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRealSourceAdapter,
  RealSourceAdapterConfig,
  RealSourceAdapterDeps,
  RealSourceAdapterResult
} from "../../src/sentinel/realSourceAdapter.js";
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

function makeRealSourceConfig(): RealSourceAdapterConfig {
  return {
    version: 1,
    runtime: {
      date: "2026-06-16",
      run_id: "runtime_20260616T073000Z",
      gates: {
        dry_run: true,
        live_network: true,
        live_model: false,
        live_publish: false
      },
      paths: {
        run_shadow_dir: runShadowDir
      },
      limits: {
        max_candidates: 20,
        max_selected_leads: 5,
        max_single_payload_tokens: 10_000,
        max_daily_tokens: 50_000
      }
    },
    source_plan: {
      version: 1,
      date: "2026-06-16",
      max_candidates_before_blind_scout: 20,
      github_search_queries: [
        {
          id: "stage_8_1_zip_noise_fixture",
          description: "fixture query for low quality ZIP download candidate",
          q: "pptx layout pushed:>2026-05-01 archived:false template:false is:public",
          sort: "updated",
          order: "desc",
          page_start: 1,
          page_limit: 1,
          per_page: 5,
          enabled: true
        }
      ],
      rss_feeds: [],
      disabled_sources: []
    },
    github: {
      token_env: "GITHUB_TOKEN",
      api_version: "2026-03-10",
      user_agent: "project-sentinel-v3-local-test",
      request_timeout_ms: 8000,
      max_concurrency: 2,
      max_pages_per_query: 1,
      per_page: 5,
      max_readme_bytes: 50 * 1024,
      max_readme_digest_chars: 50 * 1024,
      max_secondary_limit_retries: 3
    }
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

  it("persists 0-100 Project Fit evidence on shadow pipeline leads instead of captured-only shells", async () => {
    const candidate = makeCandidate(1, {
      repo: "github/runtime/pptx-skill",
      title: "Runtime PPTX Skill",
      qualityScore: 92,
      projectFitScore: 86,
      projectFit: {
        repo: "github/runtime/pptx-skill",
        project_fit_score: 86,
        evidence_quality_score: 92,
        fit_reason_codes: ["MAINLINE_MARKDOWN_TO_PPTX", "EDITABLE_PPTX_OUTPUT"],
        fit_risk_codes: ["NO_TEMPLATE_CONTROL"],
        matched_positive_terms: ["markdown to pptx", "editable pptx"],
        matched_negative_terms: ["no template"]
      }
    });

    const result = await runRuntimeOrchestrator(makeInput({ adapters: makeAdapters([candidate]) }));

    const lead = result.pipeline?.leads[0];
    expect(lead).toMatchObject({
      repo: "github/runtime/pptx-skill",
      status: "CAPTURED",
      token_roi_estimate: 0.86,
      roi_label: "Project Fit 86/100",
      source_kind: "RUNTIME_SHADOW_CANDIDATE",
      capability: {
        scoring: {
          quality_score: 92,
          project_fit_score: 86
        },
        project_fit: {
          project_fit_score: 86,
          evidence_quality_score: 92,
          fit_reason_codes: ["MAINLINE_MARKDOWN_TO_PPTX", "EDITABLE_PPTX_OUTPUT"],
          fit_risk_codes: ["NO_TEMPLATE_CONTROL"]
        }
      }
    });
    expect(JSON.stringify(lead)).not.toMatch(/Project Fit 100\/100|quality_score":1\d{2}|quality_score":200/);
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

describe("Orchestrator Pipeline E2E Integration with HintGuard", () => {
  it("keeps ZIP-download noise out of shadow leads and preserves LOW_QUALITY_FILTERED evidence", async () => {
    const previousProductionJson = await readFile(productionPipelinePath, "utf8");
    const zipRepo = "github/zip-noise-ppt";
    const zipReadme = [
      "# ZIP Noise PPT",
      "Download the zip file manually to your local directory.",
      "Visit the releases page to download the package.",
      "Extract files and double-click the file to run the application.",
      `![Download](https://github.com/${zipRepo}/raw/refs/heads/main/demo/noise.zip)`
    ].join("\n");
    let sourceResult: RealSourceAdapterResult | null = null;
    const sourceConfig = makeRealSourceConfig();
    const sourceDeps: RealSourceAdapterDeps = {
      http: {
        getJson: vi.fn(async () => ({
          status: 200,
          headers: {
            "x-ratelimit-remaining": "29"
          },
          body: {
            total_count: 1,
            incomplete_results: false,
            items: [
              {
                full_name: zipRepo,
                private: false,
                html_url: `https://github.com/${zipRepo}`,
                description: "Generate PowerPoint layouts from downloaded zip package",
                default_branch: "main",
                pushed_at: "2026-06-16T07:00:00.000Z",
                created_at: "2026-06-14T07:00:00.000Z",
                updated_at: "2026-06-16T07:00:00.000Z",
                stargazers_count: 120,
                forks_count: 1,
                topics: ["pptx", "layout"],
                license: { spdx_id: "MIT" }
              }
            ]
          }
        })),
        getText: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: zipReadme
        }))
      },
      fileStore: {
        writeJsonAtomic: vi.fn(async () => undefined),
        writeTextAtomic: vi.fn(async () => undefined)
      },
      logger: {
        write: vi.fn(async () => undefined)
      },
      fixtureFallback: [],
      blacklist: {
        repos: [],
        authors: []
      },
      sleep: vi.fn(async () => undefined),
      now: () => fixedNow,
      env: {}
    };
    const realSource = createRealSourceAdapter(sourceConfig, sourceDeps);
    const adapters = makeAdapters([]);
    adapters.liveSource = {
      fetchCandidates: vi.fn(async () => {
        sourceResult = await realSource.fetchCandidates();
        return sourceResult.candidates;
      }),
      fetchShadowEvidence: vi.fn(async () => sourceResult?.shadow_evidence ?? {})
    };
    adapters.mockModel.invoke = vi.fn(async () => ({ provider: "mock" }));

    const result = await runRuntimeOrchestrator(
      makeInput({
        config: makeConfig({ live_network: true }),
        adapters
      })
    );
    const shadowPipeline = JSON.parse(await readFile(result.shadow_pipeline_path, "utf8")) as {
      leads: Array<{ repo: string }>;
      shadow_evidence?: Record<string, { status: string; evidence: { reason_codes: string[] } }>;
    };

    expect(await readFile(productionPipelinePath, "utf8")).toBe(previousProductionJson);
    expect(shadowPipeline.leads).toEqual([]);
    expect(shadowPipeline.shadow_evidence?.[zipRepo]).toMatchObject({
      status: "LOW_QUALITY_FILTERED",
      evidence: {
        reason_codes: expect.arrayContaining(["ZIP_DOWNLOAD_DOMINATED"])
      }
    });
    expect(adapters.mockModel.invoke).not.toHaveBeenCalled();
    expect(adapters.capturer.captureLead).not.toHaveBeenCalled();
  });
});
