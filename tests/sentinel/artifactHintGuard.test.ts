import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  applyArtifactHintGuard,
  scanArtifactHintGuard
} from "../../src/sentinel/artifactHintGuard.js";
import {
  buildDefaultSourcePlanV2,
  QueryMatrixEntry,
  validateQueryMatrixEntry
} from "../../src/sentinel/sourcePlan.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(currentDir, "..", "fixtures", "sources");
const fixedNow = new Date("2026-06-16T10:45:00.000Z");

async function readFixture(name: string) {
  return readFile(join(fixturesRoot, name), "utf8");
}

function makeLogger() {
  const events: Array<{ level: string; component: string; event: string; meta: Record<string, unknown> }> = [];
  return {
    events,
    write: vi.fn(async (event) => {
      events.push(event);
    })
  };
}

describe("Stage 8 SourcePlan tightening and Artifact Hint Guard TDD contract", () => {
  it("builds SourcePlan v2 with strict GitHub qualifiers and rejects broad queries", () => {
    const plan = buildDefaultSourcePlanV2({
      date: "2026-06-16",
      pushed_after: "2026-05-01",
      min_stars_default: 100,
      min_stars_fresh_breakout: 20,
      max_candidates_before_blind_scout: 20,
      topics: ["layout-engine", "vector-graphics", "typesetting"]
    });

    expect(plan.version).toBe(2);
    expect(plan.github_query_matrix.length).toBeGreaterThanOrEqual(4);
    for (const entry of plan.github_query_matrix) {
      expect(entry.q).toContain("pushed:>2026-05-01");
      expect(entry.q).toContain("archived:false");
      expect(entry.q).toContain("template:false");
      expect(entry.q).toContain("is:public");
      expect(entry.page_limit).toBeLessThanOrEqual(2);
      expect(entry.per_page).toBeLessThanOrEqual(50);
      expect(entry.q).not.toBe("pptx layout pushed:>=2026-06-16");
      validateQueryMatrixEntry(entry);
    }

    const broadQuery: QueryMatrixEntry = {
      id: "too_broad",
      intent: "pptx_generation",
      q: "pptx pdf presentation stars:>100 is:public archived:false template:false",
      sort: "updated",
      order: "desc",
      page_limit: 1,
      per_page: 20,
      min_quality_floor: 45,
      enabled: true
    };

    expect(() => validateQueryMatrixEntry(broadQuery)).toThrow(/SOURCE_QUERY_TOO_BROAD/);
  });

  it("filters ZIP-download and prompt-wrapper README patterns into shadow evidence without downstream calls", async () => {
    const logger = makeLogger();
    const zipReadme = await readFixture("low-quality-zip-readme.md");
    const promptWrapperReadme = [
      "# Prompt Slide Wrapper",
      "Generate slides with a prompt. AI decides placement. No code required.",
      "Just describe your desired layout and the prompt determines position."
    ].join("\n");
    const downstream = {
      blindScout: vi.fn(async () => undefined),
      capturer: vi.fn(async () => undefined),
      auditor: vi.fn(async () => undefined)
    };
    const writeEnvelopeEvidence = vi.fn(async () => undefined);

    const zipResult = await applyArtifactHintGuard({
      repo: "probe/pdf2ppt",
      readme: zipReadme,
      artifactUrls: [
        "https://github.com/example/pdf2ppt/raw/refs/heads/main/demo/pdf_ppt_1.4.zip",
        "https://github.com/example/pdf2ppt/raw/refs/heads/main/demo/pdf_ppt_1.4.zip"
      ],
      maxScanMs: 50,
      now: () => fixedNow,
      logger,
      writeEnvelopeEvidence,
      downstream
    });

    const promptResult = await applyArtifactHintGuard({
      repo: "probe/prompt-wrapper",
      readme: promptWrapperReadme,
      artifactUrls: [],
      maxScanMs: 50,
      now: () => fixedNow,
      logger,
      writeEnvelopeEvidence,
      downstream
    });

    expect(zipResult).toMatchObject({
      status: "LOW_QUALITY_FILTERED",
      roi_multiplier: 0,
      checkpoint_marker: "LOW_QUALITY_FILTERED",
      reason_codes: expect.arrayContaining(["ZIP_DOWNLOAD_DOMINATED"])
    });
    expect(promptResult).toMatchObject({
      status: "LOW_QUALITY_FILTERED",
      roi_multiplier: 0,
      checkpoint_marker: "LOW_QUALITY_FILTERED",
      reason_codes: expect.arrayContaining(["PROMPT_WRAPPER_LANGUAGE", "NO_TEST_OR_EXAMPLE_SIGNAL"])
    });
    expect(writeEnvelopeEvidence).toHaveBeenCalledTimes(2);
    expect(downstream.blindScout).not.toHaveBeenCalled();
    expect(downstream.capturer).not.toHaveBeenCalled();
    expect(downstream.auditor).not.toHaveBeenCalled();
  });

  it("times out malformed README fingerprint scans and safely marks the repo LOW_QUALITY_FILTERED", async () => {
    const logger = makeLogger();
    const malformedReadme = `${"[]{}()<>!*_".repeat(10_000)}${"A".repeat(20_000)}`;

    const result = await scanArtifactHintGuard({
      repo: "probe/malformed-readme",
      readme: malformedReadme,
      artifactUrls: [],
      maxScanMs: 50,
      now: () => fixedNow,
      logger,
      scanner: () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                status: "PASS",
                roi_multiplier: 1,
                trust_score: 80,
                positive_fingerprints: ["late-pass"],
                negative_fingerprints: [],
                reason_codes: ["PASS_HIGH_TRUST_ARCHITECTURE"]
              }),
            500
          );
        })
    });

    expect(result).toMatchObject({
      status: "LOW_QUALITY_FILTERED",
      roi_multiplier: 0,
      checkpoint_marker: "LOW_QUALITY_FILTERED",
      reason_codes: expect.arrayContaining(["REGEX_SCAN_TIMEOUT"])
    });
    expect(logger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "artifact_guard_scan_timeout",
          meta: expect.objectContaining({ repo: "probe/malformed-readme" })
        })
      ])
    );
  });
});

