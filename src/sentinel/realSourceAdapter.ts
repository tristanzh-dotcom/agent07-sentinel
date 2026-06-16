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

export function createRealSourceAdapter(_config: RealSourceAdapterConfig, _deps: RealSourceAdapterDeps): RealSourceAdapter {
  return {
    fetchCandidates: async () => {
      throw new RealSourceAdapterNotImplementedError("createRealSourceAdapter.fetchCandidates");
    }
  };
}
