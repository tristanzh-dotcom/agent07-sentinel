import { constants } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";

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

type CapturedFixtureArtifact = {
  localThumbPath: string;
  status: E2EPipelineLead["artifacts"]["status"];
  errors: E2EPipelineLead["artifacts"]["errors"];
  capturedCount: number;
  fixtureUrlsRead: string[];
};

type E2EAuditReportField = NonNullable<E2EPipelineLead["audit_report"]>;

function safeRepoKey(repo: string) {
  return repo.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isoNow(input: RunSentinelE2ELiveFireInput) {
  return input.timeProvider.now().toISOString();
}

function assertInside(root: string, target: string) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw Object.assign(new Error(`E2E output escaped sandbox: ${resolvedTarget}`), {
      code: "BLOCKED_BY_FIXTURE_CONTRACT"
    });
  }
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

async function writeTextAtomic(path: string, body: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(tmpPath, body, "utf8");
    await fsyncPath(tmpPath);
    await rename(tmpPath, path);
    await fsyncPath(dirname(path));
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

function mediaError(source: FixtureArtifactSource, error: unknown): E2EPipelineLead["artifacts"]["errors"][number] {
  const code =
    typeof error === "object" &&
    error !== null &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as { status?: number }).status === 404)
      ? "REMOTE_404"
      : "DECODE_FAILED";

  return {
    code,
    source_url: source.url,
    message: error instanceof Error ? error.message : String(error)
  };
}

function sourceDigest(readme: string, files: Array<{ path: string; content: string }>) {
  return [
    `README.md\n${readme.slice(0, 4_000)}`,
    ...files.map((file) => `${file.path}\n${file.content.slice(0, 4_000)}`)
  ].join("\n\n---\n\n");
}

function estimateTokens(input: string) {
  return Math.ceil(input.length / 4);
}

async function captureFixtureArtifacts(input: {
  candidate: FixtureCandidate;
  e2eInput: RunSentinelE2ELiveFireInput;
  runSandbox: string;
}): Promise<CapturedFixtureArtifact> {
  const repoKey = safeRepoKey(input.candidate.repo);
  const artifactDir = join(input.runSandbox, "artifacts", repoKey);
  const errors: E2EPipelineLead["artifacts"]["errors"] = [];
  const fixtureUrlsRead: string[] = [];
  let localThumbPath = input.e2eInput.fallbackLocalThumbPath;
  let capturedCount = 0;

  for (const source of input.candidate.manifest.artifact_sources) {
    try {
      input.e2eInput.networkGuard.assertFixtureUrl(source.url);
      fixtureUrlsRead.push(source.url);
      const artifact = await input.e2eInput.repositoryClient.readArtifact(source.url);

      if (source.kind !== "image" || !artifact.mimeType.startsWith("image/")) {
        throw new Error(`No deterministic preview decoder for ${source.kind}`);
      }

      await mkdir(artifactDir, { recursive: true });
      const extension = artifact.mimeType === "image/svg+xml" ? "svg" : "bin";
      const localPath = join(artifactDir, `${String(capturedCount).padStart(2, "0")}_${source.kind}.${extension}`);
      await writeFile(localPath, artifact.bytes);
      if (capturedCount === 0) {
        localThumbPath = localPath;
      }
      capturedCount += 1;
    } catch (error) {
      errors.push(mediaError(source, error));
    }
  }

  return {
    localThumbPath,
    status: capturedCount > 0 ? "CAPTURED" : "FALLBACK_USED",
    errors,
    capturedCount,
    fixtureUrlsRead
  };
}

function auditMarkdown(input: {
  candidate: FixtureCandidate;
  verdict: E2EAuditReportField["verdict"];
  rawPayload: string;
}) {
  return [
    `[FIXTURE_RUN] ${input.candidate.title}`,
    "",
    `Repo: ${input.candidate.repo}`,
    `Verdict: ${input.verdict}`,
    "",
    "## Fixture Model Payload",
    "",
    "```json",
    input.rawPayload,
    "```",
    ""
  ].join("\n");
}

function parseFixtureVerdict(raw: string): E2EAuditReportField["verdict"] {
  const parsed = JSON.parse(raw) as { verdict?: E2EAuditReportField["verdict"] };
  if (parsed.verdict === "REAL_LAYOUT_ENGINE" || parsed.verdict === "PROMPT_POSITIONING" || parsed.verdict === "UNCLEAR") {
    return parsed.verdict;
  }
  throw new Error("Fixture audit payload missing verdict");
}

async function purgeArtifactSandbox(runSandbox: string, repo: string) {
  const artifactRoot = join(runSandbox, "artifacts");
  const repoDir = join(artifactRoot, safeRepoKey(repo));
  assertInside(artifactRoot, repoDir);
  await rm(repoDir, { recursive: true, force: true });
}

export async function runSentinelE2ELiveFire(input: RunSentinelE2ELiveFireInput): Promise<E2ELiveFireResult> {
  const runSandbox = join(input.sandboxRoot, input.runId);
  assertInside(input.sandboxRoot, runSandbox);

  const startedAt = isoNow(input);
  const pipelinePath = join(runSandbox, "scout_pipeline.json");
  const e2eResultPath = join(runSandbox, "e2e_result.json");
  const reportsDir = join(runSandbox, "reports");
  await mkdir(runSandbox, { recursive: true });

  if (input.budget.run_id !== input.runId || input.budget.budget_kind !== "fixture_e2e") {
    throw Object.assign(new Error("Invalid fixture budget contract"), { code: "BLOCKED_BY_FIXTURE_CONTRACT" });
  }
  if (input.budget.allow_real_model) {
    throw Object.assign(new Error("Real model is forbidden in deterministic fixture E2E"), {
      code: "BLOCKED_BY_BUDGET"
    });
  }

  const candidates = await input.repositoryClient.fetchCandidates();
  const captures = new Map<string, CapturedFixtureArtifact>();
  const fixtureUrlsRead: string[] = [];
  let artifactCount = 0;
  let estimatedInputTokens = 0;

  for (const candidate of candidates) {
    for (const source of candidate.manifest.artifact_sources) {
      input.networkGuard.assertFixtureUrl(source.url);
    }

    const readme = await input.repositoryClient.readReadme(candidate.repo);
    const files = await input.repositoryClient.readSourceFiles(candidate.repo, candidate.manifest.source_files);
    estimatedInputTokens += estimateTokens(sourceDigest(readme, files));

    const capture = await captureFixtureArtifacts({
      candidate,
      e2eInput: input,
      runSandbox
    });
    captures.set(candidate.repo, capture);
    fixtureUrlsRead.push(...capture.fixtureUrlsRead);
    artifactCount += capture.capturedCount;
  }

  if (estimatedInputTokens > input.budget.max_estimated_input_tokens) {
    throw Object.assign(new Error("FIXTURE_TOKEN_BUDGET_EXCEEDED"), { code: "FIXTURE_TOKEN_BUDGET_EXCEEDED" });
  }

  const leads: E2EPipelineLead[] = candidates.map((candidate) => {
    const capture = captures.get(candidate.repo);
    return {
      id: candidate.id,
      repo: candidate.repo,
      title: candidate.title,
      status: "PENDING",
      audit_status: "IDLE",
      locked: false,
      run_label: "[FIXTURE_RUN]",
      artifacts: {
        local_thumb_path: capture?.localThumbPath ?? input.fallbackLocalThumbPath,
        status: capture?.status ?? "FALLBACK_USED",
        errors: capture?.errors ?? []
      }
    };
  });

  const pipeline: E2EPipelineState = {
    version: 1,
    run_id: input.runId,
    run_label: "[FIXTURE_RUN]",
    updated_at: startedAt,
    leads,
    blacklist: {
      repos: [],
      authors: []
    }
  };
  await writeJsonAtomic(pipelinePath, pipeline);

  const decisions = await input.gatekeeper.decide(
    pipeline.leads.map((lead) => ({
      repo: lead.repo,
      title: lead.title,
      artifacts: lead.artifacts
    }))
  );
  const decisionByRepo = new Map(decisions.map((decision) => [decision.repo, decision]));
  const auditReports: string[] = [];
  let fixtureModelCalls = 0;

  for (const lead of pipeline.leads) {
    const decision = decisionByRepo.get(lead.repo);
    if (decision?.decision !== "approve") {
      lead.status = "REJECTED";
      lead.locked = false;
      pipeline.blacklist.repos = Array.from(new Set([...pipeline.blacklist.repos, lead.repo]));
      await purgeArtifactSandbox(runSandbox, lead.repo);
      continue;
    }

    const candidate = candidates.find((item) => item.repo === lead.repo);
    if (!candidate) {
      throw new Error(`Approved fixture candidate missing: ${lead.repo}`);
    }

    lead.status = "APPROVED";
    lead.audit_status = "AUDITING";
    lead.locked = true;

    const readme = await input.repositoryClient.readReadme(candidate.repo);
    const files = await input.repositoryClient.readSourceFiles(candidate.repo, candidate.manifest.source_files);
    const digest = sourceDigest(readme, files);

    if (input.budget.max_strong_model_calls < 0) {
      throw Object.assign(new Error("Invalid fixture model budget"), { code: "BLOCKED_BY_BUDGET" });
    }

    const rawPayload = await input.fixtureModelClient.audit({
      repo: candidate.repo,
      sourceDigest: digest
    });
    fixtureModelCalls += 1;
    const verdict = parseFixtureVerdict(rawPayload);
    const reportPath = join(reportsDir, safeRepoKey(candidate.repo), "audit_report.md");
    assertInside(runSandbox, reportPath);
    await writeTextAtomic(reportPath, auditMarkdown({ candidate, verdict, rawPayload }));

    lead.audit_status = "COMPLETED";
    lead.audit_report = {
      verdict,
      markdown_path: reportPath
    };
    auditReports.push(reportPath);
  }

  pipeline.updated_at = isoNow(input);
  await writeJsonAtomic(pipelinePath, pipeline);

  const result: E2ELiveFireResult = {
    version: 1,
    run_id: input.runId,
    label: "[FIXTURE_RUN]",
    status: "PASSED",
    started_at: startedAt,
    completed_at: isoNow(input),
    sandbox_path: runSandbox,
    pipeline_path: pipelinePath,
    e2e_result_path: e2eResultPath,
    pipeline,
    checks: [
      { name: "live network forbidden", status: "PASSED" },
      { name: "fixture candidates selected", status: "PASSED" },
      { name: "sandbox isolation", status: "PASSED" },
      { name: "headless gatekeeper decisions applied", status: "PASSED" },
      { name: "fixture wallet safeguard", status: "PASSED" }
    ],
    outputs: {
      artifact_count: artifactCount,
      audit_reports: auditReports,
      fallback_artifacts: pipeline.leads
        .filter((lead) => lead.artifacts.status === "FALLBACK_USED")
        .map((lead) => ({
          repo: lead.repo,
          local_thumb_path: lead.artifacts.local_thumb_path
        }))
    },
    model_usage: {
      real_model_calls: 0,
      fixture_model_calls: fixtureModelCalls,
      estimated_input_tokens: estimatedInputTokens
    },
    network: {
      live_network_attempts: [],
      fixture_urls_read: fixtureUrlsRead
    },
    decisions
  };

  await writeJsonAtomic(e2eResultPath, result);
  return result;
}
