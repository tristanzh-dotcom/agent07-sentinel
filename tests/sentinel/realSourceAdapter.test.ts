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
  await rm(root, { recursive: true, force: true });
});

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
});
