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
      expect(entry.q).toContain(entry.id.startsWith("canonical_") ? "pushed:>2025-01-01" : "pushed:>2026-05-01");
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

  it("adds Agent07 Top5-oriented PPTX skill and template-layout search lanes to the default source plan", () => {
    const plan = buildDefaultSourcePlanV2({
      date: "2026-06-17",
      pushed_after: "2026-05-01",
      min_stars_default: 100,
      min_stars_fresh_breakout: 20,
      max_candidates_before_blind_scout: 50,
      topics: ["layout-engine", "vector-graphics", "typesetting", "pptx-generation"]
    });

    const queriesById = Object.fromEntries(plan.github_query_matrix.map((entry) => [entry.id, entry.q]));

    expect(queriesById.readme_markdown_to_pptx).toContain("markdown");
    expect(queriesById.readme_markdown_to_pptx).toContain("pptx");
    expect(queriesById.readme_pptx_skill).toContain("skill");
    expect(queriesById.readme_powerpoint_template_layout).toContain("template");
    expect(queriesById.readme_powerpoint_template_layout).toContain("layout");
    expect(queriesById.readme_pptxgenjs).toContain("pptxgenjs");
    expect(queriesById.readme_python_pptx_markdown).toContain("python-pptx");
    expect(plan.github_query_matrix.filter((entry) => entry.intent === "pptx_generation").length).toBeGreaterThanOrEqual(4);
    for (const entry of plan.github_query_matrix) {
      validateQueryMatrixEntry(entry);
    }
  });

  it("prioritizes exact PPTX generation search lanes before broad layout and vector queries", () => {
    const plan = buildDefaultSourcePlanV2({
      date: "2026-06-17",
      pushed_after: "2026-05-01",
      min_stars_default: 100,
      min_stars_fresh_breakout: 20,
      max_candidates_before_blind_scout: 50,
      topics: ["layout-engine", "vector-graphics", "typesetting", "pptx-generation"]
    });

    const enabledIds = plan.github_query_matrix.filter((entry) => entry.enabled).map((entry) => entry.id);

    expect(enabledIds.slice(0, 6)).toEqual([
      "readme_pptxgenjs",
      "readme_powerpoint_generator",
      "readme_pptx_automizer",
      "readme_react_pptx",
      "readme_markdown_to_pptx",
      "readme_python_pptx_markdown"
    ]);
    expect(enabledIds.indexOf("readme_markdown_to_pptx")).toBeLessThan(enabledIds.indexOf("topic_layout_engine"));
    expect(enabledIds.indexOf("readme_pptxgenjs")).toBeLessThan(enabledIds.indexOf("topic_vector_graphics"));
  });

  it("adds canonical mature PPTX library lanes with a wider freshness window so stable libraries are not missed", () => {
    const plan = buildDefaultSourcePlanV2({
      date: "2026-06-17",
      pushed_after: "2026-05-01",
      min_stars_default: 100,
      min_stars_fresh_breakout: 20,
      max_candidates_before_blind_scout: 50,
      topics: ["pptx-generation"]
    });

    const queriesById = Object.fromEntries(plan.github_query_matrix.map((entry) => [entry.id, entry.q]));

    expect(queriesById.canonical_pptxgenjs).toContain("pptxgenjs");
    expect(queriesById.canonical_pptx_automizer).toContain("pptx-automizer");
    expect(queriesById.canonical_react_pptx).toContain("react-pptx");
    expect(queriesById.canonical_pptxgenjs).toContain("pushed:>2025-01-01");
    expect(queriesById.canonical_pptxgenjs).not.toContain("pushed:>2026-05-01");
    expect(plan.github_query_matrix.findIndex((entry) => entry.id === "canonical_pptxgenjs")).toBeLessThan(
      plan.github_query_matrix.findIndex((entry) => entry.id === "topic_pptx_generation")
    );
    for (const id of ["canonical_pptxgenjs", "canonical_pptx_automizer", "canonical_react_pptx"]) {
      validateQueryMatrixEntry(plan.github_query_matrix.find((entry) => entry.id === id)!);
    }
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

  it("passes high-intent PPTX generation libraries with examples even when README lacks generic architecture wording", async () => {
    const logger = makeLogger();
    const readme = [
      "# dom-to-pptx",
      "Converts HTML elements into fully editable PowerPoint and PPTX slides.",
      "Preserves gradients, shadows, rounded images, and responsive layouts.",
      "Includes examples/demo pages and sample output decks for testing.",
      "Usage: import { convert } from 'dom-to-pptx';"
    ].join("\n");

    const result = await scanArtifactHintGuard({
      repo: "probe/dom-to-pptx",
      readme,
      artifactUrls: [],
      queryIntent: "pptx_generation",
      maxScanMs: 50,
      now: () => fixedNow,
      logger
    });

    expect(result).toMatchObject({
      status: "PASS",
      roi_multiplier: 1,
      reason_codes: expect.arrayContaining(["NO_ARCHITECTURE_SIGNAL", "PASS_TESTS_AND_DOCS", "NO_VISUAL_ARTIFACT_SIGNAL"])
    });
    expect(result.trust_score).toBeGreaterThanOrEqual(45);
  });

  it("treats Agent07 advanced_ppt category as high-intent PPTX generation for artifact guard gating", async () => {
    const logger = makeLogger();
    const readme = [
      "# Slide Image to Editable PPTX",
      "Turn slide screenshots into pixel-accurate, fully editable PowerPoint files.",
      "Built with PptxGenJS and packaged as a Codex Skill.",
      "Includes screenshots, examples, sample decks, and validation reports."
    ].join("\n");

    const result = await scanArtifactHintGuard({
      repo: "probe/slide-image-to-editable-pptx",
      readme,
      artifactUrls: [],
      queryIntent: "advanced_ppt",
      maxScanMs: 50,
      now: () => fixedNow,
      logger
    });

    expect(result).toMatchObject({
      status: "PASS",
      roi_multiplier: 1,
      reason_codes: expect.arrayContaining(["NO_ARCHITECTURE_SIGNAL", "PASS_TESTS_AND_DOCS", "PASS_VISUAL_EXAMPLES"])
    });
    expect(result.trust_score).toBeGreaterThanOrEqual(45);
  });

  it("does not misclassify markdown table cells such as pipe-shape as shell-pipe local pollution", async () => {
    const logger = makeLogger();
    const readme = [
      "# json-to-office",
      "Generate professional .docx and .pptx files from JSON definitions.",
      "Architecture: a JSON schema and rendering pipeline maps structured slides to real Office files.",
      "Examples and tests cover the PPTX renderer.",
      "![Visual Playground](docs/playground.gif)",
      "| shape | 15 types: rect, ellipse, arrow, star, cloud |"
    ].join("\n");

    const result = await scanArtifactHintGuard({
      repo: "probe/json-to-office",
      readme,
      artifactUrls: [],
      queryIntent: "advanced_ppt",
      maxScanMs: 50,
      now: () => fixedNow,
      logger
    });

    expect(result).toMatchObject({
      status: "PASS",
      roi_multiplier: 1
    });
    expect(result.reason_codes).not.toContain("LOCAL_INSTALL_POLLUTION");
  });

  it("passes high-intent PPTX converters with visual artifact evidence even when tests are absent", async () => {
    const logger = makeLogger();
    const readme = [
      "# html-to-ppt-pdf",
      "Convert HTML decks to PDF and PPTX for offline PowerPoint presentations.",
      "The output is intended for editable presentation review.",
      "![preview](https://github.com/probe/html-to-ppt-pdf/raw/main/docs/preview.png)"
    ].join("\n");

    const result = await scanArtifactHintGuard({
      repo: "probe/html-to-ppt-pdf",
      readme,
      artifactUrls: ["https://github.com/probe/html-to-ppt-pdf/raw/main/docs/preview.png"],
      queryIntent: "advanced_ppt",
      maxScanMs: 50,
      now: () => fixedNow,
      logger
    });

    expect(result).toMatchObject({
      status: "PASS",
      roi_multiplier: 1,
      reason_codes: expect.arrayContaining(["NO_TEST_OR_EXAMPLE_SIGNAL", "PASS_VISUAL_EXAMPLES"])
    });
    expect(result.trust_score).toBeGreaterThanOrEqual(45);
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
