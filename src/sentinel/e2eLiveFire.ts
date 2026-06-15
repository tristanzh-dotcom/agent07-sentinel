export class E2ELiveFireNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "E2ELiveFireNotImplementedError";
  }
}

export type E2ELiveFireStatus = "PASSED" | "FAILED" | "BLOCKED_BY_BUDGET" | "BLOCKED_BY_FIXTURE_CONTRACT";

export type FixtureRunLabel = "[FIXTURE_RUN]";

export type FixtureArtifactSource = {
  kind: "image" | "pdf" | "video";
  url: string;
  path: string;
};

export type FixtureManifest = {
  fixture_id: string;
  repo: string;
  category: string;
  expected_gate_decision: "approve" | "reject" | "fallback-only";
  expected_audit_verdict: "REAL_LAYOUT_ENGINE" | "PROMPT_POSITIONING" | "UNCLEAR";
  readme_path: string;
  source_files: string[];
  artifact_sources: FixtureArtifactSource[];
};

export type FixtureCandidate = {
  id: string;
  repo: string;
  title: string;
  category: string;
  qualityScore: number;
  manifest: FixtureManifest;
  run_label: FixtureRunLabel;
};

export type FixtureRepositoryClient = {
  fetchCandidates: () => Promise<FixtureCandidate[]>;
  readReadme: (repo: string) => Promise<string>;
  readSourceFiles: (repo: string, paths: string[]) => Promise<Array<{ path: string; content: string }>>;
  readArtifact: (sourceUrl: string) => Promise<{ bytes: Uint8Array; mimeType: string }>;
};

export type LiveNetworkGuard = {
  assertFixtureUrl: (url: string) => void;
};

export type FixtureStrongModelClient = {
  audit: (input: { repo: string; sourceDigest: string }) => Promise<string>;
};

export type RealStrongModelClient = {
  invoke: (input: { repo: string; payload: string }) => Promise<unknown>;
};

export type FixtureTokenBudget = {
  run_id: string;
  budget_kind: "fixture_e2e";
  max_strong_model_calls: number;
  max_estimated_input_tokens: number;
  max_estimated_output_tokens: number;
  allow_real_model: boolean;
};

export type TimeProvider = {
  now: () => Date;
};

export type HeadlessGatekeeperDecision = {
  repo: string;
  decision: "approve" | "reject";
  reason: string;
};

export type HeadlessGatekeeper = {
  decide: (leads: Array<{ repo: string; title: string; artifacts: unknown }>) => Promise<HeadlessGatekeeperDecision[]>;
};

export type E2EPipelineLead = {
  id: string;
  repo: string;
  title: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  audit_status: "IDLE" | "AUDITING" | "COMPLETED" | "AUDIT_FAILED";
  locked: boolean;
  run_label: FixtureRunLabel;
  artifacts: {
    local_thumb_path: string;
    status: "PENDING" | "CAPTURED" | "FALLBACK_USED" | "CLEANED";
    errors: Array<{ code: string; source_url: string; message: string }>;
  };
  audit_report?: {
    verdict: "REAL_LAYOUT_ENGINE" | "PROMPT_POSITIONING" | "UNCLEAR";
    markdown_path: string;
  };
};

export type E2EPipelineState = {
  version: 1;
  run_id: string;
  run_label: FixtureRunLabel;
  updated_at: string;
  leads: E2EPipelineLead[];
  blacklist: {
    repos: string[];
    authors: string[];
  };
};

export type E2ELiveFireResult = {
  version: 1;
  run_id: string;
  label: FixtureRunLabel;
  status: E2ELiveFireStatus;
  started_at: string;
  completed_at: string;
  sandbox_path: string;
  pipeline_path: string;
  e2e_result_path: string;
  pipeline: E2EPipelineState;
  checks: Array<{ name: string; status: E2ELiveFireStatus }>;
  outputs: {
    artifact_count: number;
    audit_reports: string[];
    fallback_artifacts: Array<{ repo: string; local_thumb_path: string }>;
  };
  model_usage: {
    real_model_calls: number;
    fixture_model_calls: number;
    estimated_input_tokens: number;
  };
  network: {
    live_network_attempts: string[];
    fixture_urls_read: string[];
  };
  decisions: HeadlessGatekeeperDecision[];
};

export type RunSentinelE2ELiveFireInput = {
  fixturesRoot: string;
  sandboxRoot: string;
  runId: string;
  repositoryClient: FixtureRepositoryClient;
  networkGuard: LiveNetworkGuard;
  gatekeeper: HeadlessGatekeeper;
  fixtureModelClient: FixtureStrongModelClient;
  realModelClient: RealStrongModelClient;
  budget: FixtureTokenBudget;
  timeProvider: TimeProvider;
  fallbackLocalThumbPath: string;
};

export async function runSentinelE2ELiveFire(_input: RunSentinelE2ELiveFireInput): Promise<E2ELiveFireResult> {
  throw new E2ELiveFireNotImplementedError("runSentinelE2ELiveFire");
}
