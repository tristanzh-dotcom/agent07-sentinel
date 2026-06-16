import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Agent07RuntimeMutex,
  Agent07RuntimeRunResult,
  Agent07RuntimeSafeTriggerConfig,
  handleAgent07RuntimeTrigger,
  readAgent07RuntimeShadowSummary
} from "../../src/sentinel/agent07RuntimeController.js";

const fixedNow = new Date("2026-06-16T08:00:00.000Z");

let root: string;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeRuntimeResult(runId: string): Agent07RuntimeRunResult {
  return {
    version: 1,
    run_id: runId,
    date: "2026-06-16",
    status: "DRY_RUN_COMPLETED",
    shadow_pipeline_path: join(root, "runtime_shadow", runId, "scout_pipeline.shadow.json"),
    published_pipeline_path: null,
    warnings: []
  };
}

async function seedProductionPipeline() {
  const productionPath = join(root, "data", "scout_pipeline.json");
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(
    productionPath,
    `${JSON.stringify(
      {
        version: 1,
        run_id: "production-stable",
        updated_at: "2026-06-16T07:00:00.000Z",
        leads: [{ id: "stable", repo: "github/stable/current", title: "Current Production", status: "PENDING" }],
        blacklist: { repos: [], authors: [] }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return productionPath;
}

async function seedShadowRun() {
  const runShadowDir = join(root, "storage", "runtime_shadow", "runtime_20260616T080000Z");
  await mkdir(join(runShadowDir, "sources"), { recursive: true });
  const shadowEvidence = Object.fromEntries(
    Array.from({ length: 39 }, (_, index) => [
      `owner/filtered-${index}`,
      {
        repo: `owner/filtered-${index}`,
        status: "LOW_QUALITY_FILTERED",
        source: "artifact_hint_guard",
        captured_at: fixedNow.toISOString(),
        evidence: {
          status: "LOW_QUALITY_FILTERED",
          reason_codes: ["LOCAL_INSTALL_POLLUTION"],
          matched_terms: ["manually download zip"]
        }
      }
    ])
  );
  const lowRelevanceOverflow = {
    "owner/overflow-a": {
      repo: "owner/overflow-a",
      status: "LOW_RELEVANCE_OVERFLOW",
      source: "lead_promotion_scorer",
      captured_at: fixedNow.toISOString(),
      evidence: {
        relevance_score: 41,
        matched_negative_terms: ["ios widget"],
        demote_reason_codes: ["IOS_WIDGET_SCOPE"]
      }
    },
    "owner/overflow-b": {
      repo: "owner/overflow-b",
      status: "LOW_RELEVANCE_OVERFLOW",
      source: "lead_promotion_scorer",
      captured_at: fixedNow.toISOString(),
      evidence: {
        relevance_score: 39,
        matched_negative_terms: ["generic chart library"],
        demote_reason_codes: ["GENERIC_CHART_LIBRARY"]
      }
    }
  };
  await writeFile(
    join(runShadowDir, "scout_pipeline.shadow.json"),
    `${JSON.stringify(
      {
        version: 1,
        run_id: "runtime_20260616T080000Z",
        run_label: "[RUNTIME_DRY_RUN]",
        updated_at: fixedNow.toISOString(),
        leads: [
          {
            id: "vmprint",
            repo: "cosmiciron/vmprint",
            title: "VMPrint",
            status: "PENDING",
            promotion: {
              relevance_score: 200,
              matched_positive_terms: ["deterministic layout engine", "glyph coordinates"]
            }
          }
        ],
        shadow_evidence: shadowEvidence,
        low_relevance_overflow: lowRelevanceOverflow,
        readme_skip_evidence: {
          "owner/rate-limited": {
            repo: "owner/rate-limited",
            status: "README_RATE_LIMIT_SKIPPED",
            source: "readme_budget_guard",
            captured_at: fixedNow.toISOString(),
            evidence: {
              requested_sleep_ms: 6000,
              reason: "COMPLIANT_SLEEP_EXCEEDED"
            }
          }
        },
        blacklist: { repos: [], authors: [] }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(runShadowDir, "source_query_checkpoint.json"),
    `${JSON.stringify(
      {
        version: 1,
        run_id: "runtime_20260616T080000Z",
        batches: [
          {
            id: "layout-engine",
            status: "QUERY_TIMEOUT_SKIPPED"
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return runShadowDir;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent07-runtime-controller-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Agent07 Runtime Controller Stage 10 TDD contract", () => {
  it("forces safe trigger gates and rejects concurrent trigger requests", async () => {
    const deferred = createDeferred<Agent07RuntimeRunResult>();
    const invocations: Agent07RuntimeSafeTriggerConfig[] = [];
    const mutex: Agent07RuntimeMutex = { active_run_id: null };

    const first = handleAgent07RuntimeTrigger(
      { mode: "LIVE_NETWORK_SHADOW_PROBE", date: "2026-06-16", live_model: true, live_publish: true },
      {
        mutex,
        now: () => fixedNow,
        invokeRuntime: async (config) => {
          invocations.push(config);
          return deferred.promise;
        }
      }
    ).catch((error: unknown) => error);

    const second = await handleAgent07RuntimeTrigger(
      { mode: "LIVE_NETWORK_SHADOW_PROBE", date: "2026-06-16" },
      {
        mutex,
        now: () => fixedNow,
        invokeRuntime: async () => {
          throw new Error("second invocation must not run");
        }
      }
    );

    expect(second).toMatchObject({
      ok: false,
      status: "ORCHESTRATOR_BUSY",
      http_status: 409
    });

    deferred.resolve(makeRuntimeResult("runtime_20260616T080000Z"));
    const firstResult = await first;

    expect(firstResult).toMatchObject({ ok: true, status: "STARTING" });
    expect(invocations[0]).toMatchObject({
      gates: {
        dry_run: true,
        live_network: true,
        live_model: false,
        live_publish: false
      }
    });
  });

  it("summarizes shadow evidence counts and reason metadata for runtime visualization", async () => {
    const shadowDir = await seedShadowRun();

    const summary = await readAgent07RuntimeShadowSummary({
      run_id: "runtime_20260616T080000Z",
      run_shadow_dir: shadowDir
    });

    expect(summary).toMatchObject({
      version: 1,
      run_id: "runtime_20260616T080000Z",
      low_quality_filtered_count: 39,
      low_relevance_overflow_count: 2,
      readme_skip_count: 1,
      query_timeout_skipped_count: 1
    });
    expect(summary.shadow_evidence[0]).toMatchObject({
      status: "LOW_QUALITY_FILTERED",
      reasons: expect.arrayContaining(["LOCAL_INSTALL_POLLUTION"])
    });
  });

  it("keeps production scout_pipeline.json byte-identical when UI trigger runs a shadow probe", async () => {
    const productionPath = await seedProductionPipeline();
    const before = await readFile(productionPath, "utf8");
    const beforeStat = await stat(productionPath);

    await handleAgent07RuntimeTrigger(
      { mode: "LIVE_NETWORK_SHADOW_PROBE", date: "2026-06-16" },
      {
        mutex: { active_run_id: null },
        now: () => fixedNow,
        production_pipeline_path: productionPath,
        invokeRuntime: async (config) => {
          expect(config.gates.live_publish).toBe(false);
          return makeRuntimeResult(config.run_id);
        }
      }
    );

    const after = await readFile(productionPath, "utf8");
    const afterStat = await stat(productionPath);
    expect(after).toBe(before);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });
});
