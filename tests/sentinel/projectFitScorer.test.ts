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

const domToPptx = {
  repo: "atharva9167j/dom-to-pptx",
  title: "dom-to-pptx",
  description: "Converts HTML elements into fully editable PowerPoint slides and pixel-accurate PPTX content.",
  readme_digest: "A client-side library that converts any HTML element into a fully editable PowerPoint slide with examples and sample decks.",
  topics: ["pptx", "powerpoint", "slides"],
  artifact_url_candidates: [],
  evidence_quality_score: 75
};

const pptxGenJs = {
  repo: "gitbrent/PptxGenJS",
  title: "PptxGenJS",
  description: "Build PowerPoint presentations with JavaScript. Works with Node, React, web browsers, and more.",
  readme_digest: "Create PowerPoint presentations and PPTX decks with JavaScript.",
  topics: ["pptx", "powerpoint", "javascript"],
  artifact_url_candidates: [],
  evidence_quality_score: 95
};

const iosLayoutWidget = {
  repo: "facebook/quicklayout",
  title: "QuickLayout",
  description: "A declarative layout library for iOS designed to work with UIKit.",
  readme_digest: "QuickLayout is a custom-built iOS UIKit layout helper.",
  topics: ["ios", "uikit", "layout"],
  artifact_url_candidates: [],
  evidence_quality_score: 47
};

const vectorPaintProgram = {
  repo: "shenciao/ciallo",
  title: "Ciallo",
  description: "The next-generation vector paint program built with Godot C#.",
  readme_digest: "Vector paint editor with canvas drawing tools and layers.",
  topics: ["vector-graphics", "paint", "canvas"],
  artifact_url_candidates: [],
  evidence_quality_score: 78
};

const officeXmlViewer = {
  repo: "yukiyokotani/office-open-xml-viewer",
  title: "Office Open XML Viewer",
  description: "A browser-based viewer for Office Open XML documents that renders to an HTML Canvas element.",
  readme_digest: "Render Office Open XML documents, including PPTX files, into a canvas viewer.",
  topics: ["office-open-xml", "canvas", "viewer"],
  artifact_url_candidates: [],
  evidence_quality_score: 99
};

const genericSkillCollection = {
  repo: "mxyhi/ok-skills",
  title: "OK Skills",
  description: "Curated AI coding agent skills and AGENTS.md playbooks.",
  readme_digest:
    "This repo bundles reusable skills for docs lookup, browser automation, GitHub workflow, frontend design, PDF/Word/PPTX/XLSX authoring.",
  topics: ["codex", "claude-code", "skills"],
  artifact_url_candidates: [],
  evidence_quality_score: 100
};

const classroomAgentPlatform = {
  repo: "THU-MAIC/OpenMAIC",
  title: "OpenMAIC",
  description: "Open multi-agent interactive classroom platform.",
  readme_digest:
    "Turns any topic or document into an interactive classroom experience with generated slides, quizzes, simulations, TTS, Feishu and Telegram integration.",
  topics: ["agent", "classroom", "slides"],
  artifact_url_candidates: [],
  evidence_quality_score: 100
};

const semanticaAgentPlatform = {
  repo: "semantica-agi/semantica",
  title: "Semantica",
  description: "The context and accountability layer for AI systems.",
  readme_digest:
    "Context graphs, decision intelligence, AI governance, CLI commands, REST endpoints, audit trails, integrations and knowledge explorer visuals.",
  topics: ["ai", "agents", "governance"],
  artifact_url_candidates: [],
  evidence_quality_score: 100
};

const genericAiPresentationSurface = {
  repo: "example/generic-ai-presentations",
  title: "Generic AI Presentations",
  description: "AI presentation generator with OpenAI providers and polished PowerPoint decks.",
  readme_digest:
    "Generate presentations using OpenAI, agents, and exportable PowerPoint decks. The README shows outcomes but does not document a concrete input-to-PPTX path or template reuse.",
  topics: ["openai", "presentations", "powerpoint"],
  artifact_url_candidates: [],
  evidence_quality_score: 100
};

const jsonToOffice = {
  repo: "Wiseair-srl/json-to-office",
  title: "json-to-office",
  description: "Generate professional .docx and .pptx files from JSON definitions.",
  readme_digest:
    "Documents as data, not code. Describe .docx and .pptx files as plain JSON and render them into real Office documents with JSON schema, PPTX examples, tests, and visual playground.",
  topics: ["pptx", "office", "json"],
  artifact_url_candidates: ["https://github.com/Wiseair-srl/json-to-office/raw/main/docs/playground.gif"],
  evidence_quality_score: 90
};

const slideImageToEditablePptx = {
  repo: "w1163222589-coder/slide-image-to-editable-pptx",
  title: "Slide Image To Editable Pptx",
  description: "A Codex skill for converting slide screenshots into editable PowerPoint decks.",
  readme_digest:
    "High-Fidelity Conversion of Slide Screenshots into Editable PowerPoint. Turn slide screenshots into pixel-accurate, fully editable PowerPoint files. Built with PptxGenJS and packaged as a Codex Skill for Claude Code.",
  topics: ["codex-skill", "editable-pptx", "powerpoint", "pptx", "slides"],
  artifact_url_candidates: [],
  evidence_quality_score: 100
};

const htmlToPptPdf = {
  repo: "bolynwang/html-to-ppt-pdf",
  title: "Html To Ppt Pdf",
  description:
    "Agents skill — convert guizang-ppt-skill HTML decks to PDF + PPTX for offline presentations. The PPTX is image-based for offline talks.",
  readme_digest:
    "zan-html-to-ppt converts horizontal HTML decks to PDF and PPTX for offline presentations. Claude Code skill. Node CLI. Output PPTX is image based.",
  topics: [],
  artifact_url_candidates: ["https://github.com/bolynwang/html-to-ppt-pdf/raw/main/docs/preview.png"],
  evidence_quality_score: 100
};

const presentationPptMaker = {
  repo: "elinglijiaoqiao/presentation-ppt-maker",
  title: "Presentation Ppt Maker",
  description: "A Claude Code skill that transforms academic papers into a structured slide deck.",
  readme_digest:
    "Paper-to-Presentation is a Claude Code skill that transforms a batch of academic papers into a structured slide deck through figure extraction, text curation, narrative architecture, and slide generation. Includes CLI workflow.",
  topics: [],
  artifact_url_candidates: [],
  evidence_quality_score: 100
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

  it("keeps HTML-to-PPTX generation above generic iOS layout and vector paint tools", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const pptx = scoreAgent07ProjectFit(domToPptx);
    const ios = scoreAgent07ProjectFit(iosLayoutWidget);
    const vector = scoreAgent07ProjectFit(vectorPaintProgram);

    expect(pptx.project_fit_score).toBeGreaterThanOrEqual(80);
    expect(ios.project_fit_score).toBeLessThanOrEqual(45);
    expect(vector.project_fit_score).toBeLessThanOrEqual(45);
    expect(ios.fit_risk_codes).toEqual(expect.arrayContaining(["MOBILE_UI_LAYOUT_ONLY"]));
    expect(vector.fit_risk_codes).toEqual(expect.arrayContaining(["VECTOR_GRAPHICS_EDITOR_ONLY"]));
  });

  it("promotes direct PowerPoint/PPTX generation libraries as mainline candidates", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const score = scoreAgent07ProjectFit(pptxGenJs);

    expect(score.project_fit_score).toBeGreaterThanOrEqual(85);
    expect(score.fit_reason_codes).toEqual(expect.arrayContaining(["POWERPOINT_GENERATION_LIBRARY"]));
    expect(score.fit_risk_codes).not.toContain("NO_PRESENTATION_GENERATION_SIGNAL");
  });

  it("does not misread words like visuals as iOS-only mobile layout risk", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const score = scoreAgent07ProjectFit(domToPptx);

    expect(score.project_fit_score).toBeGreaterThanOrEqual(80);
    expect(score.fit_risk_codes).not.toContain("MOBILE_UI_LAYOUT_ONLY");
  });

  it("demotes generic skill collections and agent platforms even when README mentions PPTX or slides", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const collection = scoreAgent07ProjectFit(genericSkillCollection);
    const classroom = scoreAgent07ProjectFit(classroomAgentPlatform);
    const semantica = scoreAgent07ProjectFit(semanticaAgentPlatform);

    expect(collection.project_fit_score).toBeLessThanOrEqual(55);
    expect(collection.fit_risk_codes).toEqual(expect.arrayContaining(["COLLECTION_OR_AWESOME_LIST"]));
    expect(classroom.project_fit_score).toBeLessThanOrEqual(60);
    expect(classroom.fit_risk_codes).toEqual(expect.arrayContaining(["CLASSROOM_OR_AGENT_PLATFORM"]));
    expect(semantica.project_fit_score).toBeLessThanOrEqual(55);
    expect(semantica.fit_risk_codes).toEqual(expect.arrayContaining(["NO_PRESENTATION_GENERATION_SIGNAL"]));
  });

  it("does not demote real Office/PPTX generation libraries merely because docs mention a collection-like data shape", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const score = scoreAgent07ProjectFit(jsonToOffice);

    expect(score.project_fit_score).toBeGreaterThanOrEqual(80);
    expect(score.fit_reason_codes).toEqual(expect.arrayContaining(["POWERPOINT_GENERATION_LIBRARY"]));
    expect(score.fit_risk_codes).not.toContain("COLLECTION_OR_AWESOME_LIST");
  });

  it("caps generic AI presentation surfaces below full fit when no concrete generation path is documented", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const score = scoreAgent07ProjectFit(genericAiPresentationSurface);

    expect(score.project_fit_score).toBeLessThanOrEqual(88);
    expect(score.fit_reason_codes).toEqual(expect.arrayContaining(["CODEX_SKILL_COMPATIBLE", "EDITABLE_PPTX_OUTPUT"]));
    expect(score.fit_reason_codes).not.toEqual(
      expect.arrayContaining(["MAINLINE_MARKDOWN_TO_PPTX", "HTML_TO_PPTX_GENERATION", "POWERPOINT_GENERATION_LIBRARY", "TEMPLATE_LAYOUT_REUSE"])
    );
  });

  it("calibrates current Agent07 Top5 candidates with differentiated 0-100 business-fit scores", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const scores = [
      slideImageToEditablePptx,
      presentationPptMaker,
      jsonToOffice,
      domToPptx,
      htmlToPptPdf
    ].map((candidate) => ({
      repo: candidate.repo,
      score: scoreAgent07ProjectFit(candidate).project_fit_score,
      risks: scoreAgent07ProjectFit(candidate).fit_risk_codes
    }));

    expect(new Set(scores.map((entry) => entry.score)).size).toBeGreaterThanOrEqual(4);
    expect(scores.find((entry) => entry.repo === slideImageToEditablePptx.repo)?.score).toBeGreaterThanOrEqual(92);
    expect(scores.find((entry) => entry.repo === presentationPptMaker.repo)?.score).toBeGreaterThanOrEqual(88);
    expect(scores.find((entry) => entry.repo === jsonToOffice.repo)?.score).toBeGreaterThanOrEqual(80);
    expect(scores.find((entry) => entry.repo === domToPptx.repo)?.score).toBeGreaterThanOrEqual(80);
    expect(scores.find((entry) => entry.repo === htmlToPptPdf.repo)?.score).toBeLessThanOrEqual(84);
    expect(scores.find((entry) => entry.repo === htmlToPptPdf.repo)?.risks).toEqual(expect.arrayContaining(["STATIC_CONVERTER_ONLY"]));
  });

  it("caps high-evidence document viewers without explicit PowerPoint/PPTX generation signal", async () => {
    const { scoreAgent07ProjectFit } = await loadProjectFitScorer();
    const viewer = scoreAgent07ProjectFit(officeXmlViewer);

    expect(viewer.project_fit_score).toBeLessThanOrEqual(55);
    expect(viewer.fit_risk_codes).toEqual(expect.arrayContaining(["VIEWER_ONLY_NO_GENERATION"]));
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
