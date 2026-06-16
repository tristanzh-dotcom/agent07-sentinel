import { join } from "node:path";
import type { RuntimeCandidate, RuntimeGates } from "./runtimeOrchestrator.js";

export class RealSourceAdapterNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "RealSourceAdapterNotImplementedError";
  }
}

export type RealSourceAdapterStatus = "COMPLETED" | "SOURCE_THROTTLED" | "FAILED_RECOVERABLE";

export type GitHubRepositorySearchQuery = {
  id: string;
  description: string;
  q: string;
  sort: "updated" | "stars" | "forks" | "help-wanted-issues";
  order: "desc" | "asc";
  page_start: 1;
  page_limit: number;
  per_page: number;
  enabled: boolean;
};

export type SourcePlan = {
  version: 1;
  date: string;
  max_candidates_before_blind_scout: number;
  github_search_queries: GitHubRepositorySearchQuery[];
  rss_feeds: unknown[];
  disabled_sources: unknown[];
};

export type RealSourceAdapterConfig = {
  version: 1;
  runtime: {
    date: string;
    run_id: string;
    gates: RuntimeGates;
    paths: {
      run_shadow_dir: string;
    };
    limits: {
      max_candidates: number;
      max_selected_leads: 5;
      max_single_payload_tokens: number;
      max_daily_tokens: number;
    };
  };
  source_plan: SourcePlan;
  github: {
    token_env: "GITHUB_TOKEN";
    api_version: string;
    user_agent: string;
    request_timeout_ms: number;
    max_concurrency: number;
    max_pages_per_query: number;
    per_page: number;
    max_readme_bytes: number;
    max_readme_digest_chars: number;
    max_secondary_limit_retries: number;
  };
};

export type SourceCandidateEnvelope = {
  version: 1;
  source_id: string;
  source_kind: "github_repository_search" | "rss_feed" | "cached_snapshot";
  fetched_at: string;
  dedupe_key: string;
  repo: {
    full_name: string;
    owner: string;
    name: string;
    html_url: string;
    private: false;
    default_branch?: string;
    pushed_at?: string;
    created_at?: string;
    updated_at?: string;
    stars?: number;
    forks?: number;
    topics: string[];
    license_spdx_id?: string | null;
  };
  content: {
    title: string;
    description: string;
    readme_digest: string;
    readme_truncated: boolean;
    artifact_url_candidates: string[];
  };
  scoring: {
    deterministic_score: number;
    matched_keywords: string[];
    artifact_hint_count: number;
    freshness_score: number;
    source_confidence: "HIGH" | "MEDIUM" | "LOW";
  };
  safety: {
    blacklisted: boolean;
    blocked_reason?: string;
    network_calls_used: number;
    token_cost: 0;
  };
};

export type HttpHeaders = Record<string, string | undefined>;

export type HttpJsonResult<T> = {
  status: number;
  headers: HttpHeaders;
  body: T;
};

export type HttpTextResult = {
  status: number;
  headers: HttpHeaders;
  body: string;
};

export type HttpRequestSpec = {
  url: string;
  headers: Record<string, string>;
  timeout_ms: number;
  source_id: string;
  idempotency_key: string;
};

export type RateLimitedHttpClient = {
  getJson: (request: HttpRequestSpec) => Promise<HttpJsonResult<unknown>>;
  getText: (request: HttpRequestSpec) => Promise<HttpTextResult>;
};

export type RealSourceLogger = {
  write: (event: {
    level: "DEBUG" | "INFO" | "WARN" | "ERROR";
    component: string;
    event: string;
    meta: Record<string, unknown>;
  }) => Promise<void> | void;
};

export type RealSourceFileStore = {
  writeJsonAtomic: (path: string, value: unknown) => Promise<void>;
  writeTextAtomic: (path: string, value: string) => Promise<void>;
};

export type RealSourceAdapterDeps = {
  http: RateLimitedHttpClient;
  fileStore: RealSourceFileStore;
  logger: RealSourceLogger;
  fixtureFallback: RuntimeCandidate[];
  blacklist: {
    repos: string[];
    authors: string[];
  };
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  env: Record<string, string | undefined>;
};

export type RealSourceAdapterResult = {
  version: 1;
  run_id: string;
  status: RealSourceAdapterStatus;
  candidates: RuntimeCandidate[];
  envelopes: SourceCandidateEnvelope[];
  shadow_paths: {
    source_candidates_runtime: string;
    source_candidates_envelope: string;
  };
  network: {
    live_network_used: boolean;
    search_requests: number;
    readme_requests: number;
  };
  rate_limit: {
    retry_count: number;
    circuit_breaker_open: boolean;
    reason?: "PRIMARY_RATE_LIMIT" | "SECONDARY_RATE_LIMIT";
  };
};

export type RealSourceAdapter = {
  fetchCandidates: () => Promise<RealSourceAdapterResult>;
};

type GitHubSearchResponse = {
  total_count?: number;
  incomplete_results?: boolean;
  items?: GitHubSearchItem[];
};

type GitHubSearchItem = {
  full_name?: string;
  private?: boolean;
  html_url?: string;
  description?: string | null;
  default_branch?: string;
  pushed_at?: string;
  created_at?: string;
  updated_at?: string;
  stargazers_count?: number;
  forks_count?: number;
  topics?: string[];
  license?: { spdx_id?: string | null } | null;
};

const DOMAIN_KEYWORDS = [
  "pptx",
  "slide",
  "slides",
  "presentation",
  "layout",
  "typesetting",
  "svg",
  "pdf",
  "artifact",
  "multimodal",
  "canvas",
  "diagram",
  "magazine"
];

function sourceRoot(config: RealSourceAdapterConfig) {
  return join(config.runtime.paths.run_shadow_dir, "sources");
}

function runtimeCandidatesPath(config: RealSourceAdapterConfig) {
  return join(sourceRoot(config), "source_candidates.runtime.json");
}

function envelopeCandidatesPath(config: RealSourceAdapterConfig) {
  return join(sourceRoot(config), "source_candidates.envelope.json");
}

function readmeDigestPath(config: RealSourceAdapterConfig, repo: string) {
  return join(sourceRoot(config), "readmes", `${sanitizePathKey(repo)}.digest.md`);
}

function sanitizePathKey(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, "__").replace(/^_+|_+$/g, "");
}

function normalizeRepo(input: string) {
  return input.toLowerCase();
}

function repoOwner(repo: string) {
  return normalizeRepo(repo).split("/")[0] ?? "";
}

function githubTokenStatus(config: RealSourceAdapterConfig, deps: RealSourceAdapterDeps) {
  return deps.env[config.github.token_env] ? "set" : "unset";
}

function githubHeaders(config: RealSourceAdapterConfig, deps: RealSourceAdapterDeps) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": config.github.api_version,
    "User-Agent": config.github.user_agent
  };
  const token = deps.env[config.github.token_env];
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function isRateLimited(status: number) {
  return status === 403 || status === 429;
}

function isPrimaryRateLimit(headers: HttpHeaders) {
  return headers["x-ratelimit-remaining"] === "0";
}

function rateLimitDelayMs(headers: HttpHeaders, now: Date) {
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }

  const resetEpoch = headers["x-ratelimit-reset"];
  if (resetEpoch) {
    const epochSeconds = Number.parseInt(resetEpoch, 10);
    if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
      return Math.max(0, epochSeconds * 1000 - now.getTime());
    }
  }

  return 1000;
}

function truncateUtf8(input: string, maxBytes: number, maxChars: number) {
  const inputBuffer = Buffer.from(input, "utf8");
  let text = input;
  let truncated = false;

  if (inputBuffer.length > maxBytes) {
    truncated = true;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let end = maxBytes; end >= Math.max(0, maxBytes - 4); end -= 1) {
      try {
        text = decoder.decode(inputBuffer.subarray(0, end));
        break;
      } catch {
        if (end === Math.max(0, maxBytes - 4)) text = inputBuffer.subarray(0, end).toString("utf8");
      }
    }
  }

  if (text.length > maxChars) {
    truncated = true;
    text = text.slice(0, maxChars);
  }

  return { text, truncated };
}

function matchedKeywords(item: GitHubSearchItem, readme = "") {
  const haystack = `${item.full_name ?? ""} ${item.description ?? ""} ${(item.topics ?? []).join(" ")} ${readme}`.toLowerCase();
  return DOMAIN_KEYWORDS.filter((keyword) => haystack.includes(keyword));
}

function artifactHints(readme: string) {
  const hints: string[] = [];
  const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of readme.matchAll(markdownImagePattern)) {
    const url = match[1];
    if (!url) continue;
    if (isAcceptedArtifactHint(url)) hints.push(url);
  }
  return hints;
}

function isAcceptedArtifactHint(url: string) {
  if (url.startsWith("https://github.com/")) return true;
  if (url.startsWith("https://raw.githubusercontent.com/")) return true;
  if (url.startsWith("https://user-images.githubusercontent.com/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".githubusercontent.com");
  } catch {
    return !url.includes(":") && !url.startsWith("/");
  }
}

function deterministicScore(item: GitHubSearchItem, readme: string, artifactHintCount: number) {
  const keywordScore = Math.min(35, matchedKeywords(item, readme).length * 7);
  const artifactScore = Math.min(25, artifactHintCount * 8);
  const freshnessScore = item.pushed_at || item.updated_at ? 20 : 0;
  const toolShapeScore = /cli|engine|export|layout|render/i.test(`${item.full_name ?? ""} ${item.description ?? ""}`) ? 10 : 0;
  const communityScore = item.license || item.stargazers_count || item.forks_count ? 10 : 0;
  return keywordScore + artifactScore + freshnessScore + toolShapeScore + communityScore;
}

function titleFromRepo(repo: string) {
  const name = repo.split("/").at(-1) ?? repo;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function categoryFor(item: GitHubSearchItem, readme: string) {
  const text = `${item.full_name ?? ""} ${item.description ?? ""} ${(item.topics ?? []).join(" ")} ${readme}`.toLowerCase();
  if (text.includes("ppt") || text.includes("slide") || text.includes("presentation")) return "advanced_ppt";
  if (text.includes("svg") || text.includes("diagram")) return "svg_synthesis";
  if (text.includes("pdf") || text.includes("document") || text.includes("typesetting")) return "magazine_composition";
  return "multimodal_layout";
}

function searchUrl(query: GitHubRepositorySearchQuery, page: number, config: RealSourceAdapterConfig) {
  const params = new URLSearchParams({
    q: query.q,
    sort: query.sort,
    order: query.order,
    per_page: String(Math.min(query.per_page, config.github.per_page)),
    page: String(page)
  });
  return `https://api.github.com/search/repositories?${params.toString()}`;
}

function readmeUrl(repo: string) {
  return `https://api.github.com/repos/${repo}/readme`;
}

async function writeOutputs(
  config: RealSourceAdapterConfig,
  deps: RealSourceAdapterDeps,
  candidates: RuntimeCandidate[],
  envelopes: SourceCandidateEnvelope[]
) {
  await deps.fileStore.writeJsonAtomic(runtimeCandidatesPath(config), candidates);
  await deps.fileStore.writeJsonAtomic(envelopeCandidatesPath(config), envelopes);
}

export async function fetchRealSources(
  config: RealSourceAdapterConfig,
  deps: RealSourceAdapterDeps
): Promise<RealSourceAdapterResult> {
  const shadowPaths = {
    source_candidates_runtime: runtimeCandidatesPath(config),
    source_candidates_envelope: envelopeCandidatesPath(config)
  };

  if (!config.runtime.gates.live_network) {
    await deps.logger.write({
      level: "INFO",
      component: "realSourceAdapter",
      event: "live_network_gate_blocked",
      meta: {
        run_id: config.runtime.run_id,
        github_token_status: githubTokenStatus(config, deps)
      }
    });
    await deps.fileStore.writeJsonAtomic(shadowPaths.source_candidates_runtime, deps.fixtureFallback);
    await deps.fileStore.writeJsonAtomic(shadowPaths.source_candidates_envelope, []);
    return {
      version: 1,
      run_id: config.runtime.run_id,
      status: "COMPLETED",
      candidates: deps.fixtureFallback,
      envelopes: [],
      shadow_paths: shadowPaths,
      network: {
        live_network_used: false,
        search_requests: 0,
        readme_requests: 0
      },
      rate_limit: {
        retry_count: 0,
        circuit_breaker_open: false
      }
    };
  }

  const headers = githubHeaders(config, deps);
  const blacklistRepos = new Set(deps.blacklist.repos.map(normalizeRepo));
  const blacklistAuthors = new Set(deps.blacklist.authors.map((author) => author.toLowerCase()));
  const itemsByRepo = new Map<string, GitHubSearchItem>();
  let searchRequests = 0;
  let readmeRequests = 0;
  let retryCount = 0;
  let circuitBreakerOpen = false;

  for (const query of config.source_plan.github_search_queries.filter((candidate) => candidate.enabled)) {
    const pageLimit = Math.min(query.page_limit, config.github.max_pages_per_query);
    for (let pageOffset = 0; pageOffset < pageLimit; pageOffset += 1) {
      const page = query.page_start + pageOffset;
      const result = await deps.http.getJson({
        url: searchUrl(query, page, config),
        headers,
        timeout_ms: config.github.request_timeout_ms,
        source_id: query.id,
        idempotency_key: `${query.id}:page:${page}`
      });
      searchRequests += 1;

      if (isRateLimited(result.status)) {
        retryCount += 1;
        await deps.logger.write({
          level: "WARN",
          component: "realSourceAdapter.github",
          event: "github_rate_limit_backoff",
          meta: {
            run_id: config.runtime.run_id,
            source_id: query.id,
            status: result.status,
            github_token_status: githubTokenStatus(config, deps)
          }
        });
        await deps.sleep(rateLimitDelayMs(result.headers, deps.now()));
        continue;
      }

      const body = result.body as GitHubSearchResponse;
      for (const item of body.items ?? []) {
        if (!item.full_name || item.private) continue;
        const repo = normalizeRepo(item.full_name);
        if (!itemsByRepo.has(repo)) itemsByRepo.set(repo, item);
      }
    }
  }

  const candidates: RuntimeCandidate[] = [];
  const envelopes: SourceCandidateEnvelope[] = [];

  for (const [repo, item] of itemsByRepo) {
    if (candidates.length >= config.source_plan.max_candidates_before_blind_scout) break;

    const owner = repoOwner(repo);
    if (blacklistRepos.has(repo) || blacklistAuthors.has(owner)) {
      await deps.logger.write({
        level: "INFO",
        component: "realSourceAdapter.github",
        event: "candidate_blacklist_skipped",
        meta: {
          run_id: config.runtime.run_id,
          repo,
          github_token_status: githubTokenStatus(config, deps)
        }
      });
      continue;
    }

    let readmeDigest = "";
    let readmeTruncated = false;
    let artifactUrls: string[] = [];

    while (true) {
      const result = await deps.http.getText({
        url: readmeUrl(repo),
        headers,
        timeout_ms: config.github.request_timeout_ms,
        source_id: "github_readme",
        idempotency_key: `readme:${repo}`
      });
      readmeRequests += 1;

      if (!isRateLimited(result.status)) {
        if (result.status === 200) {
          const truncated = truncateUtf8(result.body, config.github.max_readme_bytes, config.github.max_readme_digest_chars);
          readmeDigest = truncated.text;
          readmeTruncated = truncated.truncated;
          artifactUrls = artifactHints(readmeDigest);

          if (readmeTruncated) {
            await deps.logger.write({
              level: "WARN",
              component: "realSourceAdapter.github",
              event: "readme_fetch_truncated",
              meta: {
                run_id: config.runtime.run_id,
                repo,
                max_readme_bytes: config.github.max_readme_bytes,
                github_token_status: githubTokenStatus(config, deps)
              }
            });
          }

          await deps.fileStore.writeTextAtomic(readmeDigestPath(config, repo), readmeDigest);
        }
        break;
      }

      retryCount += 1;
      await deps.logger.write({
        level: "WARN",
        component: "realSourceAdapter.github",
        event: "github_rate_limit_backoff",
        meta: {
          run_id: config.runtime.run_id,
          repo,
          status: result.status,
          rate_limit_kind: isPrimaryRateLimit(result.headers) ? "PRIMARY_RATE_LIMIT" : "SECONDARY_RATE_LIMIT",
          retry_count: retryCount,
          github_token_status: githubTokenStatus(config, deps)
        }
      });

      if (retryCount >= config.github.max_secondary_limit_retries) {
        circuitBreakerOpen = true;
        await deps.logger.write({
          level: "ERROR",
          component: "realSourceAdapter.github",
          event: "github_source_throttled",
          meta: {
            run_id: config.runtime.run_id,
            repo,
            reason: "SECONDARY_RATE_LIMIT",
            retry_count: retryCount,
            github_token_status: githubTokenStatus(config, deps)
          }
        });
        await writeOutputs(config, deps, candidates, envelopes);
        return {
          version: 1,
          run_id: config.runtime.run_id,
          status: "SOURCE_THROTTLED",
          candidates,
          envelopes,
          shadow_paths: shadowPaths,
          network: {
            live_network_used: true,
            search_requests: searchRequests,
            readme_requests: readmeRequests
          },
          rate_limit: {
            retry_count: retryCount,
            circuit_breaker_open: circuitBreakerOpen,
            reason: "SECONDARY_RATE_LIMIT"
          }
        };
      }

      await deps.sleep(rateLimitDelayMs(result.headers, deps.now()));
    }

    const ownerName = repo.split("/")[0] ?? "";
    const repoName = repo.split("/")[1] ?? repo;
    const score = deterministicScore(item, readmeDigest, artifactUrls.length);
    const envelope: SourceCandidateEnvelope = {
      version: 1,
      source_id: "github_search",
      source_kind: "github_repository_search",
      fetched_at: deps.now().toISOString(),
      dedupe_key: repo,
      repo: {
        full_name: repo,
        owner: ownerName,
        name: repoName,
        html_url: item.html_url ?? `https://github.com/${repo}`,
        private: false,
        default_branch: item.default_branch,
        pushed_at: item.pushed_at,
        created_at: item.created_at,
        updated_at: item.updated_at,
        stars: item.stargazers_count,
        forks: item.forks_count,
        topics: item.topics ?? [],
        license_spdx_id: item.license?.spdx_id ?? null
      },
      content: {
        title: titleFromRepo(repo),
        description: item.description ?? "",
        readme_digest: readmeDigest,
        readme_truncated: readmeTruncated,
        artifact_url_candidates: artifactUrls
      },
      scoring: {
        deterministic_score: score,
        matched_keywords: matchedKeywords(item, readmeDigest),
        artifact_hint_count: artifactUrls.length,
        freshness_score: item.pushed_at || item.updated_at ? 20 : 0,
        source_confidence: "HIGH"
      },
      safety: {
        blacklisted: false,
        network_calls_used: 1,
        token_cost: 0
      }
    };

    envelopes.push(envelope);
    candidates.push({
      id: repo,
      repo,
      title: envelope.content.title,
      category: categoryFor(item, readmeDigest),
      readme: readmeDigest,
      qualityScore: score,
      artifact_urls: artifactUrls
    });
  }

  await writeOutputs(config, deps, candidates, envelopes);
  return {
    version: 1,
    run_id: config.runtime.run_id,
    status: "COMPLETED",
    candidates,
    envelopes,
    shadow_paths: shadowPaths,
    network: {
      live_network_used: true,
      search_requests: searchRequests,
      readme_requests: readmeRequests
    },
    rate_limit: {
      retry_count: retryCount,
      circuit_breaker_open: circuitBreakerOpen
    }
  };
}

export function createRealSourceAdapter(config: RealSourceAdapterConfig, deps: RealSourceAdapterDeps): RealSourceAdapter {
  return {
    fetchCandidates: () => fetchRealSources(config, deps)
  };
}
