import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FixtureCandidate,
  FixtureManifest,
  FixtureRepositoryClient,
  HeadlessGatekeeperDecision,
  HeadlessGatekeeper,
  LiveNetworkGuard,
  RunSentinelE2ELiveFireInput,
  runSentinelE2ELiveFire
} from "../../src/sentinel/e2eLiveFire.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(currentDir, "..", "fixtures", "repositories");
const fixedNow = new Date("2026-06-15T09:00:00.000Z");
const fallbackLocalThumbPath = "./storage/assets/dark_fallback.png";

let root: string;
let sandboxRoot: string;
let runId: string;

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readManifest(fixtureId: string): Promise<FixtureManifest> {
  return JSON.parse(await readFile(join(fixturesRoot, fixtureId, "fixture-manifest.json"), "utf8")) as FixtureManifest;
}

function titleFromRepo(repo: string) {
  return repo
    .split("/")
    .at(-1)!
    .split("-")
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function createFixtureRepositoryClient(liveNetworkAttempts: string[]): Promise<FixtureRepositoryClient> {
  const manifests = await Promise.all([
    readManifest("relative-layout-engine"),
    readManifest("prompt-positioning-wrapper"),
    readManifest("broken-media-repo")
  ]);
  const manifestByRepo = new Map(manifests.map((manifest) => [manifest.repo, manifest]));
  const manifestByFixtureId = new Map(manifests.map((manifest) => [manifest.fixture_id, manifest]));

  function resolveFixtureUrl(sourceUrl: string) {
    if (!sourceUrl.startsWith("fixture://")) {
      liveNetworkAttempts.push(sourceUrl);
      throw Object.assign(new Error("LIVE_NETWORK_FORBIDDEN_IN_E2E"), { code: "LIVE_NETWORK_FORBIDDEN_IN_E2E" });
    }

    const withoutProtocol = sourceUrl.slice("fixture://".length);
    const slash = withoutProtocol.indexOf("/");
    const fixtureId = withoutProtocol.slice(0, slash);
    const relativePath = withoutProtocol.slice(slash + 1);
    const manifest = manifestByFixtureId.get(fixtureId);
    if (!manifest) throw new Error(`Unknown fixture id: ${fixtureId}`);
    return join(fixturesRoot, manifest.fixture_id, relativePath);
  }

  return {
    fetchCandidates: vi.fn(async () =>
      manifests.map(
        (manifest, index): FixtureCandidate => ({
          id: manifest.fixture_id,
          repo: manifest.repo,
          title: titleFromRepo(manifest.repo),
          category: manifest.category,
          qualityScore: 100 - index,
          manifest,
          run_label: "[FIXTURE_RUN]"
        })
      )
    ),
    readReadme: vi.fn(async (repo: string) => {
      const manifest = manifestByRepo.get(repo);
      if (!manifest) throw new Error(`Unknown fixture repo: ${repo}`);
      return readFile(join(fixturesRoot, manifest.fixture_id, manifest.readme_path), "utf8");
    }),
    readSourceFiles: vi.fn(async (repo: string, paths: string[]) => {
      const manifest = manifestByRepo.get(repo);
      if (!manifest) throw new Error(`Unknown fixture repo: ${repo}`);
      return Promise.all(
        paths.map(async (path) => ({
          path,
          content: await readFile(join(fixturesRoot, manifest.fixture_id, path), "utf8")
        }))
      );
    }),
    readArtifact: vi.fn(async (sourceUrl: string) => {
      const localPath = resolveFixtureUrl(sourceUrl);
      return {
        bytes: await readFile(localPath),
        mimeType: localPath.endsWith(".svg") ? "image/svg+xml" : localPath.endsWith(".pdf") ? "application/pdf" : "application/octet-stream"
      };
    })
  };
}

function createNetworkGuard(liveNetworkAttempts: string[]): LiveNetworkGuard {
  return {
    assertFixtureUrl: vi.fn((url: string) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        liveNetworkAttempts.push(url);
        throw Object.assign(new Error("LIVE_NETWORK_FORBIDDEN_IN_E2E"), { code: "LIVE_NETWORK_FORBIDDEN_IN_E2E" });
      }
    })
  };
}

function createGatekeeper(): HeadlessGatekeeper {
  return {
    decide: vi.fn(async (leads: Array<{ repo: string; title: string; artifacts: unknown }>): Promise<HeadlessGatekeeperDecision[]> =>
      leads.map((lead): HeadlessGatekeeperDecision => ({
        repo: lead.repo,
        decision: lead.repo === "fixture/relative-layout-engine" ? "approve" : "reject",
        reason: lead.repo === "fixture/relative-layout-engine" ? "fixture positive layout engine" : "fixture rejected by manifest"
      }))
    )
  };
}

async function createInput(overrides: Partial<RunSentinelE2ELiveFireInput> = {}): Promise<RunSentinelE2ELiveFireInput> {
  const liveNetworkAttempts: string[] = [];
  const realModelClient = {
    invoke: vi.fn(async () => {
      throw new Error("Real model must not be invoked in fixture E2E");
    })
  };

  return {
    fixturesRoot,
    sandboxRoot,
    runId,
    repositoryClient: await createFixtureRepositoryClient(liveNetworkAttempts),
    networkGuard: createNetworkGuard(liveNetworkAttempts),
    gatekeeper: createGatekeeper(),
    fixtureModelClient: {
      audit: vi.fn(async (input) =>
        JSON.stringify({
          verdict: input.repo === "fixture/relative-layout-engine" ? "REAL_LAYOUT_ENGINE" : "PROMPT_POSITIONING",
          evidence: ["[FIXTURE_RUN] deterministic fixture model response"],
          confidence: 0.91,
          integration: {
            estimated_glue_code_lines: 64,
            supports_zero_dependency_export: input.repo === "fixture/relative-layout-engine",
            friction_score: input.repo === "fixture/relative-layout-engine" ? 0.18 : 0.72
          },
          boundary_risks: ["fixture-only risk matrix"]
        })
      )
    },
    realModelClient,
    budget: {
      run_id: runId,
      budget_kind: "fixture_e2e",
      max_strong_model_calls: 0,
      max_estimated_input_tokens: 12000,
      max_estimated_output_tokens: 2000,
      allow_real_model: false
    },
    timeProvider: {
      now: () => fixedNow
    },
    fallbackLocalThumbPath,
    ...overrides
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-e2e-live-fire-"));
  sandboxRoot = join(root, "storage", "e2e_sandbox");
  runId = "fixture_run_20260615T090000Z";
  await mkdir(sandboxRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Project Sentinel E2E live-fire drill TDD contract", () => {
  it("runs the blind scout and capturer entirely from local fixtures while blocking live network access", async () => {
    const input = await createInput();

    const result = await runSentinelE2ELiveFire(input);

    expect(result.run_id).toBe(runId);
    expect(result.label).toBe("[FIXTURE_RUN]");
    expect(result.network.live_network_attempts).toEqual([]);
    expect(result.network.fixture_urls_read).toEqual(
      expect.arrayContaining([
        "fixture://relative-layout-engine/artifacts/sample-slide.svg",
        "fixture://prompt-positioning-wrapper/artifacts/prompt-output.svg",
        "fixture://broken-media-repo/artifacts/corrupt-sample.pdf"
      ])
    );
    expect(result.pipeline_path).toContain(join("storage", "e2e_sandbox", runId, "scout_pipeline.json"));
    expect(result.outputs.artifact_count).toBeGreaterThanOrEqual(2);
    expect(result.pipeline.leads).toHaveLength(3);
    expect(result.pipeline.leads.every((lead) => lead.run_label === "[FIXTURE_RUN]")).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "live network forbidden", status: "PASSED" }),
        expect.objectContaining({ name: "fixture candidates selected", status: "PASSED" }),
        expect.objectContaining({ name: "sandbox isolation", status: "PASSED" })
      ])
    );
  });

  it("uses the headless gatekeeper to approve the positive fixture, reject the negative fixture, and write fixture reports", async () => {
    const input = await createInput();

    const result = await runSentinelE2ELiveFire(input);

    const approved = result.pipeline.leads.find((lead) => lead.repo === "fixture/relative-layout-engine");
    const rejected = result.pipeline.leads.find((lead) => lead.repo === "fixture/prompt-positioning-wrapper");
    const broken = result.pipeline.leads.find((lead) => lead.repo === "fixture/broken-media-repo");
    const promptSandbox = join(sandboxRoot, runId, "artifacts", "fixture_prompt-positioning-wrapper");
    const reportPath = join(sandboxRoot, runId, "reports", "fixture_relative-layout-engine", "audit_report.md");
    const report = await readFile(reportPath, "utf8");

    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ repo: "fixture/relative-layout-engine", decision: "approve" }),
        expect.objectContaining({ repo: "fixture/prompt-positioning-wrapper", decision: "reject" })
      ])
    );
    expect(result.pipeline.blacklist.repos).toEqual(
      expect.arrayContaining(["fixture/prompt-positioning-wrapper", "fixture/broken-media-repo"])
    );
    expect(await pathExists(promptSandbox)).toBe(false);
    expect(approved).toMatchObject({
      status: "APPROVED",
      audit_status: expect.stringMatching(/AUDITING|COMPLETED/),
      locked: true,
      audit_report: expect.objectContaining({ verdict: "REAL_LAYOUT_ENGINE" })
    });
    expect(rejected?.status).toBe("REJECTED");
    expect(broken?.artifacts).toMatchObject({
      local_thumb_path: fallbackLocalThumbPath,
      status: "FALLBACK_USED",
      errors: expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/REMOTE_404|DECODE_FAILED/) })
      ])
    });
    expect(report).toContain("[FIXTURE_RUN]");
    expect(result.outputs.audit_reports).toContain(reportPath);
  });

  it("locks time and fixture wallet budget so real model calls never happen and state does not roll back", async () => {
    const realModelClient = {
      invoke: vi.fn(async () => {
        throw new Error("Real model must not be called");
      })
    };
    const input = await createInput({ realModelClient });

    const result = await runSentinelE2ELiveFire(input);

    expect(realModelClient.invoke).not.toHaveBeenCalled();
    expect(result.started_at).toBe("2026-06-15T09:00:00.000Z");
    expect(result.completed_at).toBe("2026-06-15T09:00:00.000Z");
    expect(result.model_usage).toMatchObject({
      real_model_calls: 0,
      fixture_model_calls: 1
    });
    expect(result.model_usage.estimated_input_tokens).toBeLessThanOrEqual(input.budget.max_estimated_input_tokens);
    expect(result.status).toBe("PASSED");
    expect(result.pipeline.updated_at).toBe("2026-06-15T09:00:00.000Z");
    expect(result.e2e_result_path).toContain(join("storage", "e2e_sandbox", runId, "e2e_result.json"));
  });
});
