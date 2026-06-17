import { describe, expect, it } from "vitest";
import { scoreLeadPromotion, type LeadPromotionInput } from "../../src/sentinel/leadPromotionScorer.js";

const pptxFromLayoutsSkill = {
  repo: "wozzeck16621/pptx-from-layouts-skill",
  title: "Pptx From Layouts Skill",
  description:
    "Generate professional PowerPoint decks from markdown outlines, using your template's actual layouts for polished presentations.",
  readme_digest: [
    "# Pptx From Layouts Skill",
    "Generate professional PowerPoint decks from markdown outlines.",
    "Use your template's actual layouts and slide masters.",
    "Packaged as a Codex and Claude Code skill for agent automation.",
    "Outputs editable PPTX presentations."
  ].join("\n"),
  topics: ["codex", "claude-code", "openai", "pptx-generator", "pptx-parser", "skill"],
  artifact_url_candidates: ["https://github.com/wozzeck16621/pptx-from-layouts-skill/releases/demo.zip"],
  evidence_quality_score: 83
};

const pdf2ppt = {
  repo: "muhammadfaisalshareef/pdf2ppt",
  title: "pdf2ppt",
  description: "Transform PDF files into editable PowerPoint presentations.",
  readme_digest: [
    "# pdf2ppt",
    "Convert PDF files into editable PPTX files.",
    "Includes a Telegram bot wrapper and PDF conversion workflow.",
    "Upload a PDF and receive a converted PowerPoint deck."
  ].join("\n"),
  topics: ["pdf", "pdf2pptx", "powerpoint", "slides", "summarization", "telegram"],
  artifact_url_candidates: [
    "https://github.com/muhammadfaisalshareef/pdf2ppt/blob/main/sample.pdf",
    "https://github.com/muhammadfaisalshareef/pdf2ppt/blob/main/output.pptx"
  ],
  evidence_quality_score: 91
};

async function loadProjectFitScorer() {
  return import("../../src/sentinel/projectFitScorer.js");
}

function asPromotionInput(candidate: typeof pptxFromLayoutsSkill): LeadPromotionInput {
  return {
    repo: candidate.repo,
    title: candidate.title,
    category: "advanced_ppt",
    description: candidate.description,
    readme_digest: candidate.readme_digest,
    topics: candidate.topics,
    deterministic_score: candidate.evidence_quality_score,
    artifact_url_candidates: candidate.artifact_url_candidates
  };
}

describe("Agent07 Project Fit Score contract", () => {
  it("captures the current generic relevance bug: evidence score lets side-path pdf2ppt outrank a mainline PPTX skill", () => {
    const currentMainline = scoreLeadPromotion(asPromotionInput(pptxFromLayoutsSkill));
    const currentSidePath = scoreLeadPromotion(asPromotionInput(pdf2ppt));

    expect(currentMainline.relevance_score).toBeGreaterThan(currentSidePath.relevance_score);
  });

  it("ranks mainline markdown/template PPTX skill above side-path PDF conversion even when evidence score is lower", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const mainline = scoreAgent07ProjectFit(pptxFromLayoutsSkill);
    const sidePath = scoreAgent07ProjectFit(pdf2ppt);

    expect(mainline.project_fit_score).toBeGreaterThan(sidePath.project_fit_score);
    expect(mainline.project_fit_score).toBeGreaterThanOrEqual(88);
    expect(sidePath.project_fit_score).toBeLessThanOrEqual(78);
    expect(mainline.fit_reason_codes).toEqual(
      expect.arrayContaining(["MAINLINE_MARKDOWN_TO_PPTX", "TEMPLATE_LAYOUT_REUSE", "CODEX_SKILL_COMPATIBLE"])
    );
    expect(sidePath.fit_risk_codes).toEqual(expect.arrayContaining(["SIDE_PATH_PDF_CONVERSION"]));
  });

  it("marks recall as partial and blocks final approval when fewer than Top 5 runtime candidates are available", async () => {
    const { summarizeAgent07RecallCoverage } = await loadProjectFitScorer();

    expect(summarizeAgent07RecallCoverage({ displayedCount: 2, targetCount: 5 })).toEqual({
      status: "PARTIAL_RECALL",
      displayed_count: 2,
      target_count: 5,
      blocks_final_approval: true
    });
  });

  it("marks recall as ready only when the runtime candidate set reaches the Top 5 target", async () => {
    const { summarizeAgent07RecallCoverage } = await loadProjectFitScorer();

    expect(summarizeAgent07RecallCoverage({ displayedCount: 5, targetCount: 5 })).toEqual({
      status: "READY_FOR_REVIEW",
      displayed_count: 5,
      target_count: 5,
      blocks_final_approval: false
    });
  });
});
