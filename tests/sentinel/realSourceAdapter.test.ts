import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeCandidate, RuntimeGates } from "../../src/sentinel/runtimeOrchestrator.js";
import {
  createRealSourceAdapter,
  HttpJsonResult,
  RealSourceAdapterConfig,
  RealSourceAdapterDeps
} from "../../src/sentinel/realSourceAdapter.js";

type GitHubSearchRepoItem = {
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  pushed_at: string;
  created_at: string;
  updated_at: string;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
  license?: { spdx_id: string | null } | null;
};

type GitHubSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubSearchRepoItem[];
};

let root: string;
let runShadowDir: string;

const fixedNow = new Date("2026-06-16T08:00:00.000Z");

function makeGates(overrides: Partial<RuntimeGates> = {}): RuntimeGates {
  return {
    dry_run: true,
    live_network: false,
    live_model: false,
    live_publish: false,
    ...overrides
  };
}

function makeRuntimeCandidate(index: number, overrides: Partial<RuntimeCandidate> = {}): RuntimeCandidate {
  return {
    id: `fixture-${index}`,
    repo: `fixture/source-${index}`,
    title: `Fixture Source ${index}`,
    category: "advanced_ppt",
    readme: "fixture README digest",
    qualityScore: 90 - index,
    artifact_urls: ["fixture://source/artifacts/sample.svg"],
    ...overrides
  };
}

function makeConfig(gates: Partial<RuntimeGates> = {}): RealSourceAdapterConfig {
  return {
    version: 1,
    runtime: {
      date: "2026-06-16",
      run_id: "runtime_20260616T080000Z",
      gates: makeGates(gates),
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
          id: "ppt_layout_recent",
          description: "recent public layout and presentation engines",
          q: "pptx layout pushed:>=2026-06-15",
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
      user_agent: "project-sentinel-v3-local",
      request_timeout_ms: 8000,
      max_concurrency: 2,
      max_pages_per_query: 2,
      per_page: 5,
      max_readme_bytes: 50 * 1024,
      max_readme_digest_chars: 50 * 1024,
      max_secondary_limit_retries: 3
    }
  };
}

function makeSearchItem(repo: string, description = "advanced PPT layout engine"): GitHubSearchRepoItem {
  const [owner, name] = repo.split("/");
  return {
    full_name: `${owner}/${name}`,
    private: false,
    html_url: `https://github.com/${owner}/${name}`,
    description,
    default_branch: "main",
    pushed_at: "2026-06-16T07:00:00.000Z",
    created_at: "2026-06-14T07:00:00.000Z",
    updated_at: "2026-06-16T07:00:00.000Z",
    stargazers_count: 120,
    forks_count: 7,
    topics: ["pptx", "layout", "svg"],
    license: { spdx_id: "MIT" }
  };
}

function makeSearchResponse(items: GitHubSearchRepoItem[]): GitHubSearchResponse {
  return {
    total_count: items.length,
    incomplete_results: false,
    items
  };
}

function makeDeps(overrides: Partial<RealSourceAdapterDeps> = {}): RealSourceAdapterDeps & {
  logEvents: Array<{ level: string; component: string; event: string; meta: Record<string, unknown> }>;
} {
  const logEvents: Array<{ level: string; component: string; event: string; meta: Record<string, unknown> }> = [];
  const deps: RealSourceAdapterDeps & {
    logEvents: Array<{ level: string; component: string; event: string; meta: Record<string, unknown> }>;
  } = {
    http: {
      getJson: vi.fn(async () => {
        throw Object.assign(new Error("LIVE_NETWORK_FORBIDDEN_IN_E2E"), { code: "LIVE_NETWORK_FORBIDDEN_IN_E2E" });
      }),
      getText: vi.fn(async () => {
        throw Object.assign(new Error("LIVE_NETWORK_FORBIDDEN_IN_E2E"), { code: "LIVE_NETWORK_FORBIDDEN_IN_E2E" });
      })
    },
    fileStore: {
      writeJsonAtomic: vi.fn(async () => undefined),
      writeTextAtomic: vi.fn(async () => undefined)
    },
    logger: {
      write: vi.fn(async (event) => {
        logEvents.push(event);
      })
    },
    fixtureFallback: [makeRuntimeCandidate(1), makeRuntimeCandidate(2)],
    blacklist: {
      repos: [],
      authors: []
    },
    sleep: vi.fn(async () => undefined),
    now: () => fixedNow,
    env: {},
    logEvents,
    ...overrides
  };
  return deps;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-real-source-adapter-"));
  runShadowDir = join(root, "Git-Scout", "storage", "runtime_shadow", "runtime_20260616T080000Z");
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

function highTrustReadme(name: string) {
  return [
    `# ${name}`,
    "This project implements a constraint layout engine with a relative coordinate rendering pipeline.",
    "Examples and tests live in examples/ and tests/.",
    "![Preview](https://github.com/github/high-trust-layout/raw/refs/heads/main/docs/preview.png)"
  ].join("\n");
}

function withReadmeBudget(config: RealSourceAdapterConfig): RealSourceAdapterConfig {
  const budgeted = config as RealSourceAdapterConfig & {
    github: RealSourceAdapterConfig["github"] & {
      max_compliant_sleep_ms: number;
      readme_phase_wall_clock_budget_ms: number;
      incremental_flush_every_repos: number;
      max_readme_rate_limit_retries: number;
    };
  };
  budgeted.github.max_compliant_sleep_ms = 5000;
  budgeted.github.readme_phase_wall_clock_budget_ms = 45_000;
  budgeted.github.incremental_flush_every_repos = 1;
  budgeted.github.max_readme_rate_limit_retries = 1;
  return budgeted;
}

describe("RealSourceAdapter TDD contract", () => {
  it("uses local fixture fallback when live_network is false and emits zero HTTP calls", async () => {
    const deps = makeDeps();
    const adapter = createRealSourceAdapter(makeConfig({ live_network: false }), deps);

    const result = await adapter.fetchCandidates();

    expect(result.status).toBe("COMPLETED");
    expect(result.network).toMatchObject({
      live_network_used: false,
      search_requests: 0,
      readme_requests: 0
    });
    expect(result.candidates).toEqual(deps.fixtureFallback);
    expect(deps.http.getJson).not.toHaveBeenCalled();
    expect(deps.http.getText).not.toHaveBeenCalled();
    expect(deps.fileStore.writeJsonAtomic).toHaveBeenCalledWith(
      expect.stringContaining(join("runtime_shadow", "runtime_20260616T080000Z", "sources", "source_candidates.runtime.json")),
      deps.fixtureFallback
    );
    expect(deps.logEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "live_network_gate_blocked",
          meta: expect.objectContaining({ run_id: "runtime_20260616T080000Z" })
        })
      ])
    );
  });

  it("backs off on GitHub 403/429 and opens SOURCE_THROTTLED circuit breaker after repeated secondary limits", async () => {
    const secondaryLimit403: HttpJsonResult<GitHubSearchResponse> = {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "12",
        "x-ratelimit-reset": String(Math.floor((fixedNow.getTime() + 2000) / 1000))
      },
      body: makeSearchResponse([])
    };
    const secondaryLimit429: HttpJsonResult<GitHubSearchResponse> = {
      status: 429,
      headers: {
        "retry-after": "3"
      },
      body: makeSearchResponse([])
    };
    const successfulSearch: HttpJsonResult<GitHubSearchResponse> = {
      status: 200,
      headers: {
        "x-ratelimit-remaining": "27"
      },
      body: makeSearchResponse([makeSearchItem("github/relative-layout-engine")])
    };
    const deps = makeDeps({
      http: {
        getJson: vi.fn(async <T>() => successfulSearch as unknown as HttpJsonResult<T>),
        getText: vi
          .fn()
          .mockResolvedValueOnce(secondaryLimit403)
          .mockResolvedValueOnce(secondaryLimit429)
          .mockResolvedValueOnce(secondaryLimit403)
          .mockResolvedValueOnce({
            status: 200,
            headers: {},
            body: "# Should not be fetched after circuit opens"
          })
      }
    });
    const adapter = createRealSourceAdapter(makeConfig({ live_network: true }), deps);

    const result = await adapter.fetchCandidates();

    expect(result.status).toBe("SOURCE_THROTTLED");
    expect(result.rate_limit).toMatchObject({
      retry_count: 3,
      circuit_breaker_open: true,
      reason: "SECONDARY_RATE_LIMIT"
    });
    expect(deps.http.getJson).toHaveBeenCalledTimes(1);
    expect(deps.http.getText).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(deps.sleep).toHaveBeenNthCalledWith(2, 3000);
    expect(deps.logEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "github_rate_limit_backoff" }),
        expect.objectContaining({ event: "github_source_throttled" })
      ])
    );
  });

  it("skips blacklisted repositories before README fetch and slices oversized README payloads to 50KB", async () => {
    const oversizedReadme = [
      "# Huge README",
      "This repository documents a constraint layout engine with a relative coordinate rendering pipeline.",
      "Examples and tests live in examples/ and tests/ with a screenshot gallery at docs/preview.png.",
      "",
      "![Preview](https://github.com/github/huge-readme-engine/raw/refs/heads/main/docs/preview.png)",
      "",
      "layout-token ".repeat(500_000)
    ].join("\n");
    const searchItems = [
      makeSearchItem("github/blocked-template"),
      makeSearchItem("github/huge-readme-engine"),
      makeSearchItem("github/normal-layout-one"),
      makeSearchItem("github/normal-layout-two"),
      makeSearchItem("github/normal-layout-three")
    ];
    const deps = makeDeps({
      blacklist: {
        repos: ["github/blocked-template"],
        authors: []
      },
      http: {
        getJson: vi.fn(async <T>() => ({
          status: 200,
          headers: {
            "x-ratelimit-remaining": "29"
          },
          body: makeSearchResponse(searchItems)
        }) as unknown as HttpJsonResult<T>),
        getText: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: oversizedReadme
        }))
      }
    });
    const adapter = createRealSourceAdapter(makeConfig({ live_network: true }), deps);

    const result = await adapter.fetchCandidates();
    const hugeCandidate = result.candidates.find((candidate) => candidate.repo === "github/huge-readme-engine");
    const hugeEnvelope = result.envelopes.find((candidate) => candidate.repo.full_name === "github/huge-readme-engine");

    expect(result.status).toBe("COMPLETED");
    expect(deps.http.getText).toHaveBeenCalledTimes(4);
    expect(deps.http.getText).not.toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("blocked-template")
      })
    );
    expect(result.candidates.map((candidate) => candidate.repo)).not.toContain("github/blocked-template");
    expect(hugeCandidate?.readme.length).toBeLessThanOrEqual(50 * 1024);
    expect(hugeEnvelope?.content.readme_truncated).toBe(true);
    expect(deps.fileStore.writeTextAtomic).toHaveBeenCalledWith(
      expect.stringContaining(join("sources", "readmes", "github__huge-readme-engine.digest.md")),
      expect.stringMatching(/^# Huge README/)
    );
    expect(deps.logEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "candidate_blacklist_skipped" }),
        expect.objectContaining({ event: "readme_fetch_truncated" })
      ])
    );
  });

  it("keeps runtime candidate user-visible scores on a 0-100 scale even when internal promotion score exceeds 100", async () => {
    const config = makeConfig({ live_network: true });
    config.source_plan.github_search_queries = [
      {
        ...config.source_plan.github_search_queries[0],
        id: "readme_pptxgenjs",
        q: "pptxgenjs in:readme stars:>100 pushed:>2025-01-01 archived:false template:false mirror:false is:public"
      }
    ];
    const deps = makeDeps({
      http: {
        getJson: vi.fn(async <T>() => ({
          status: 200,
          headers: { "x-ratelimit-remaining": "29" },
          body: makeSearchResponse([
            makeSearchItem(
              "github/high-score-pptx",
              "Build PowerPoint presentations with JavaScript and generate professional .docx and .pptx files from JSON definitions"
            )
          ])
        }) as unknown as HttpJsonResult<T>),
        getText: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: [
            "# High Score PPTX",
            "Build PowerPoint presentations with JavaScript.",
            "Generate professional .docx and .pptx files from JSON definitions.",
            "Render them into real Office documents with pptx generation, json-to-pptx, html-to-ppt, editable powerpoint, and examples.",
            "![preview](https://github.com/github/high-score-pptx/raw/main/docs/preview.png)"
          ].join("\n")
        }))
      }
    });

    const result = await createRealSourceAdapter(config, deps).fetchCandidates();
    const candidate = result.candidates.find((entry) => entry.repo === "github/high-score-pptx");

    expect(candidate).toBeTruthy();
    expect(candidate?.qualityScore).toBeLessThanOrEqual(100);
    expect(candidate?.projectFitScore).toBeLessThanOrEqual(100);
    expect(candidate?.projectFit?.project_fit_score).toBeLessThanOrEqual(100);
    expect(candidate?.projectFit?.evidence_quality_score).toBeLessThanOrEqual(100);
  });
});

describe("Stage 9.2 README Budget Guard TDD contract", () => {
  it("rejects README Primary Rate Limit sleeps above 5000ms while allowing short backoff", async () => {
    vi.useFakeTimers();
    const config = withReadmeBudget(makeConfig({ live_network: true }));
    const repos = [makeSearchItem("github/long-sleep-repo"), makeSearchItem("github/short-sleep-repo")];
    const deps = makeDeps({
      http: {
        getJson: vi.fn(async <T>() => ({
          status: 200,
          headers: { "x-ratelimit-remaining": "29" },
          body: makeSearchResponse(repos)
        }) as unknown as HttpJsonResult<T>),
        getText: vi
          .fn()
          .mockResolvedValueOnce({
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.floor((fixedNow.getTime() + 6000) / 1000))
            },
            body: ""
          })
          .mockResolvedValueOnce({
            status: 429,
            headers: { "retry-after": "2" },
            body: ""
          })
          .mockResolvedValueOnce({
            status: 200,
            headers: {},
            body: highTrustReadme("Short Sleep Repo")
          })
      },
      sleep: vi.fn(async () => undefined)
    });

    const result = (await createRealSourceAdapter(config, deps).fetchCandidates()) as RealSourceAdapterResultWithReadmeEvidence;

    const sleepCalls = (deps.sleep as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([ms]) => ms as number);
    expect(sleepCalls.some((ms) => ms > 5000)).toBe(false);
    expect(deps.sleep).toHaveBeenCalledWith(2000);
    expect(result.readme_skip_evidence?.["github/long-sleep-repo"]).toMatchObject({
      status: "README_RATE_LIMIT_EXCEEDED",
      source: "readme_budget_guard"
    });
    expect(deps.logEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "readme_rate_limit_sleep_rejected",
          meta: expect.objectContaining({
            repo: "github/long-sleep-repo",
            requested_sleep_ms: 6000,
            max_compliant_sleep_ms: 5000
          })
        })
      ])
    );
  });

  it("stops README fetching when the 45s phase budget is exhausted and preserves partial candidates", async () => {
    let nowMs = fixedNow.getTime();
    let readmeCalls = 0;
    const config = withReadmeBudget(makeConfig({ live_network: true }));
    const repos = [1, 2, 3, 4, 5].map((index) => makeSearchItem(`github/budget-repo-${index}`));
    const deps = makeDeps({
      now: () => new Date(nowMs),
      http: {
        getJson: vi.fn(async <T>() => ({
          status: 200,
          headers: { "x-ratelimit-remaining": "29" },
          body: makeSearchResponse(repos)
        }) as unknown as HttpJsonResult<T>),
        getText: vi.fn(async () => {
          readmeCalls += 1;
          nowMs += readmeCalls <= 2 ? 20_000 : 6001;
          return {
            status: 200,
            headers: {},
            body: highTrustReadme(`Budget Repo ${readmeCalls}`)
          };
        })
      }
    });

    const result = (await createRealSourceAdapter(config, deps).fetchCandidates()) as RealSourceAdapterResultWithReadmeEvidence;

    expect(deps.http.getText).toHaveBeenCalledTimes(3);
    expect(result.candidates.map((candidate) => candidate.repo)).toEqual(["github/budget-repo-1", "github/budget-repo-2"]);
    expect(result.readme_skip_evidence?.GLOBAL_README_PHASE).toMatchObject({
      status: "GLOBAL_BUDGET_EXHAUSTED",
      source: "readme_budget_guard"
    });
    expect(deps.logEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "readme_phase_budget_exhausted",
          meta: expect.objectContaining({
            budget_ms: 45_000
          })
        })
      ])
    );
  });

  it("flushes a parseable source_stage_snapshot after each state transition before an injected abort", async () => {
    const config = withReadmeBudget(makeConfig({ live_network: true }));
    const repos = [
      makeSearchItem("github/captured-layout-engine"),
      makeSearchItem("github/zip-filtered"),
      makeSearchItem("github/abort-after-snapshot")
    ];
    const deps = makeDeps({
      http: {
        getJson: vi.fn(async <T>() => ({
          status: 200,
          headers: { "x-ratelimit-remaining": "29" },
          body: makeSearchResponse(repos)
        }) as unknown as HttpJsonResult<T>),
        getText: vi
          .fn()
          .mockResolvedValueOnce({
            status: 200,
            headers: {},
            body: highTrustReadme("Captured Layout Engine")
          })
          .mockResolvedValueOnce({
            status: 200,
            headers: {},
            body: [
              "# Zip Filtered",
              "Download the zip file manually and place it in the root folder.",
              "![Preview](docs/preview.png)"
            ].join("\n")
          })
          .mockRejectedValueOnce(new Error("SIGINT_AFTER_INCREMENTAL_SNAPSHOT"))
      }
    });

    await expect(createRealSourceAdapter(config, deps).fetchCandidates()).rejects.toThrow("SIGINT_AFTER_INCREMENTAL_SNAPSHOT");

    expect(deps.fileStore.writeJsonAtomic).toHaveBeenCalledWith(
      expect.stringContaining("source_stage_snapshot.json"),
      expect.objectContaining({
        status: expect.stringMatching(/^SOURCE_/),
        promotion_inputs_preview: expect.arrayContaining([expect.objectContaining({ repo: "github/captured-layout-engine" })]),
        shadow_evidence: expect.objectContaining({
          "github/zip-filtered": expect.objectContaining({ status: "LOW_QUALITY_FILTERED" })
        })
      })
    );
  });
});

type RealSourceAdapterResultWithReadmeEvidence = Awaited<ReturnType<ReturnType<typeof createRealSourceAdapter>["fetchCandidates"]>> & {
  readme_skip_evidence?: Record<
    string,
    {
      status: "README_RATE_LIMIT_SKIPPED" | "README_RATE_LIMIT_EXCEEDED" | "GLOBAL_BUDGET_EXHAUSTED";
      source: "readme_budget_guard";
    }
  >;
};

describe("Stage 9 Query Batch Timeout Guard TDD contract", () => {
  it("aborts a hung Search batch at 8000ms using an AbortController signal", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const deps = makeDeps({
      http: {
        getJson: vi.fn((request) => {
          capturedSignal = request.signal;
          return new Promise<HttpJsonResult<GitHubSearchResponse>>(() => undefined);
        }),
        getText: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: highTrustReadme("unused")
        }))
      }
    });
    const adapter = createRealSourceAdapter(makeConfig({ live_network: true }), deps);

    void adapter.fetchCandidates().catch(() => undefined);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);

    expect(capturedSignal?.aborted).toBe(true);
    expect(deps.logEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "github_query_timeout_skipped",
          meta: expect.objectContaining({
            timeout_ms: 8000,
            duration_ms: expect.any(Number)
          })
        })
      ])
    );
  });

  it("continues to later query batches after one timeout and preserves successful candidates", async () => {
    vi.useFakeTimers();
    const config = makeConfig({ live_network: true });
    config.source_plan.github_search_queries = [
      { ...config.source_plan.github_search_queries[0], id: "hung_layout_query" },
      { ...config.source_plan.github_search_queries[0], id: "healthy_typesetting_query", q: "typesetting engine pushed:>2026-05-01" }
    ];
    const deps = makeDeps({
      http: {
        getJson: vi.fn((request) => {
          if (request.source_id === "hung_layout_query") {
            return new Promise<HttpJsonResult<GitHubSearchResponse>>(() => undefined);
          }
          return Promise.resolve({
            status: 200,
            headers: {
              "x-ratelimit-remaining": "29"
            },
            body: makeSearchResponse([makeSearchItem("github/layout-engine-a"), makeSearchItem("github/layout-engine-b")])
          });
        }),
        getText: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: highTrustReadme("Healthy Layout Engine")
        }))
      }
    });
    const adapter = createRealSourceAdapter(config, deps);

    const fetchPromise = adapter.fetchCandidates();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);
    await Promise.resolve();

    expect(deps.http.getJson).toHaveBeenCalledTimes(2);
    await expect(fetchPromise).resolves.toMatchObject({
      status: "COMPLETED",
      candidates: expect.arrayContaining([
        expect.objectContaining({ repo: "github/layout-engine-a" }),
        expect.objectContaining({ repo: "github/layout-engine-b" })
      ])
    });
  });

  it("writes timeout-skipped checkpoint evidence without exposing GitHub token values", async () => {
    vi.useFakeTimers();
    const token = "ghp_secret_value_for_test";
    const deps = makeDeps({
      env: {
        GITHUB_TOKEN: token
      },
      http: {
        getJson: vi.fn(() => new Promise<HttpJsonResult<GitHubSearchResponse>>(() => undefined)),
        getText: vi.fn(async () => ({
          status: 200,
          headers: {},
          body: highTrustReadme("unused")
        }))
      }
    });
    const adapter = createRealSourceAdapter(makeConfig({ live_network: true }), deps);

    void adapter.fetchCandidates().catch(() => undefined);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);

    expect(deps.fileStore.writeJsonAtomic).toHaveBeenCalledWith(
      expect.stringContaining(join("sources", "source_query_checkpoint.json")),
      expect.objectContaining({
        batches: expect.arrayContaining([
          expect.objectContaining({
            status: "QUERY_TIMEOUT_SKIPPED",
            skipped_reason: "TIMEOUT_SKIPPED"
          })
        ])
      })
    );
    const serializedLogs = JSON.stringify(deps.logEvents);
    expect(serializedLogs).toContain("github_query_timeout_skipped");
    expect(serializedLogs).toContain('"github_token_status":"set"');
    expect(serializedLogs).not.toContain(token);
  });
});
