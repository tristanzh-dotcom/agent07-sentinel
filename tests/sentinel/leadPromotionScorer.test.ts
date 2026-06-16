import { describe, expect, it, vi } from "vitest";
import {
  LeadPromotionInput,
  rankLeadPromotionCandidates,
  scoreLeadPromotion
} from "../../src/sentinel/leadPromotionScorer.js";

const fixedNow = new Date("2026-06-16T08:30:00.000Z");

function makeLead(overrides: Partial<LeadPromotionInput> & { repo: string }): LeadPromotionInput {
  const title = overrides.title ?? overrides.repo.split("/").at(-1) ?? overrides.repo;
  return {
    title,
    category: overrides.category ?? "multimodal_layout",
    readme_digest: overrides.readme_digest ?? [
      `# ${title}`,
      "This project provides examples and visual previews for generated assets."
    ].join("\n"),
    description: overrides.description ?? "Safe fixture candidate",
    topics: overrides.topics ?? ["layout"],
    deterministic_score: overrides.deterministic_score ?? 70,
    artifact_url_candidates: overrides.artifact_url_candidates ?? ["docs/preview.png"],
    ...overrides,
    repo: overrides.repo
  };
}

function vmprintLead(): LeadPromotionInput {
  return makeLead({
    repo: "cosmiciron/vmprint",
    title: "VMPrint",
    deterministic_score: 75,
    description: "Deterministic document layout engine for DTP-grade publishing.",
    topics: ["layout-engine", "typesetting", "pdf-generation", "canvas"],
    artifact_url_candidates: ["documents/assets/newsletter.png", "documents/assets/report.png"],
    readme_digest: [
      "# VMPrint",
      "VMPrint is a deterministic layout engine.",
      "The engine produces glyph coordinates, text run coordinates, and positioned primitives.",
      "It resolves deterministic pagination, page breaks, table of contents, report generation, and PDF export.",
      "Canvas and vector graphics consumers can replay the flat layout data.",
      "## Architecture",
      "![Newsletter](documents/assets/newsletter.png)"
    ].join("\n")
  });
}

function iosWidgetLead(): LeadPromotionInput {
  return makeLead({
    repo: "zekunyan/ttgtagcollectionview",
    title: "TTGTagCollectionView",
    deterministic_score: 79,
    description: "Swift iOS widget for tag CollectionView layout.",
    topics: ["ios", "swiftui", "ui"],
    artifact_url_candidates: ["Resources/promo_poster.png", "Resources/quick_start.png"],
    readme_digest: [
      "# TTGTagCollectionView",
      "A Swift-first iOS widget and tag component for UIKit CollectionView layouts.",
      "Install with CocoaPods and use this mobile component library in iOS apps."
    ].join("\n")
  });
}

describe("LeadPromotionScorer Stage 9.1 TDD contract", () => {
  it("promotes document layout engines above off-topic widgets and preserves stable order for tied candidates", () => {
    const ordinaryC = makeLead({
      repo: "github/ordinary-c",
      title: "Ordinary C",
      deterministic_score: 70,
      readme_digest: "# Ordinary C\n\nSafe layout utility with examples."
    });
    const ordinaryD = makeLead({
      repo: "github/ordinary-d",
      title: "Ordinary D",
      deterministic_score: 70,
      readme_digest: "# Ordinary D\n\nSafe layout utility with examples."
    });
    const result = rankLeadPromotionCandidates([iosWidgetLead(), ordinaryC, vmprintLead(), ordinaryD], {
      maxPromoted: 5,
      promotedFloor: 0,
      now: () => fixedNow
    });

    expect(result.promoted[0]?.repo).toBe("cosmiciron/vmprint");
    expect(result.promoted.findIndex((lead) => lead.repo === "zekunyan/ttgtagcollectionview")).toBeGreaterThan(
      result.promoted.findIndex((lead) => lead.repo === "github/ordinary-d")
    );
    expect(result.promoted.map((lead) => lead.repo)).toEqual([
      "cosmiciron/vmprint",
      "github/ordinary-c",
      "github/ordinary-d",
      "zekunyan/ttgtagcollectionview"
    ]);
  });

  it("slices promoted leads to Top 5 and isolates low-relevance overflow without downstream calls", async () => {
    const downstream = {
      blindScout: vi.fn(async (_lead: LeadPromotionInput) => undefined),
      capturer: vi.fn(async (_lead: LeadPromotionInput) => undefined),
      auditor: vi.fn(async () => undefined)
    };
    const safeCandidates = [
      vmprintLead(),
      makeLead({
        repo: "texlyre/texlyre",
        deterministic_score: 81,
        topics: ["typesetting", "typst", "latex", "pdf"],
        readme_digest: "# TeXlyre\n\nA local-first Typst and LaTeX typesetting pipeline with PDF preview gallery."
      }),
      makeLead({
        repo: "github/publishing-engine",
        deterministic_score: 74,
        topics: ["publishing", "pdf-generation"],
        readme_digest: "# Publishing Engine\n\nDocument generation, report generation, page layout engine, and PDF export."
      }),
      makeLead({
        repo: "github/vector-report-renderer",
        deterministic_score: 72,
        topics: ["svg", "canvas", "report-generation"],
        readme_digest: "# Vector Report Renderer\n\nCanvas vector graphics rendering pipeline for generated report assets."
      }),
      makeLead({
        repo: "github/pptx-layout-lab",
        deterministic_score: 70,
        topics: ["pptx", "layout-engine"],
        readme_digest: "# PPTX Layout Lab\n\nPowerPoint slide generation, deck export, and deterministic layout engine examples."
      }),
      makeLead({
        repo: "yamlresume/yamlresume",
        deterministic_score: 83,
        topics: ["resume", "yaml-resume", "typesetting"],
        readme_digest: "# YAMLResume\n\nResume and CV builder for yaml resume templates with LaTeX PDF output."
      }),
      iosWidgetLead()
    ];

    const result = rankLeadPromotionCandidates(safeCandidates, {
      maxPromoted: 5,
      promotedFloor: 60,
      now: () => fixedNow
    });
    for (const promoted of result.promoted) {
      await downstream.blindScout(promoted);
      await downstream.capturer(promoted);
    }

    expect(result.promoted).toHaveLength(5);
    expect(result.promoted.map((lead) => lead.promotion.relevance_score)).toEqual(
      [...result.promoted].map((lead) => lead.promotion.relevance_score).sort((a, b) => b - a)
    );
    expect(Object.keys(result.low_relevance_overflow).sort()).toEqual(["yamlresume/yamlresume", "zekunyan/ttgtagcollectionview"]);
    expect(result.low_relevance_overflow["zekunyan/ttgtagcollectionview"]).toMatchObject({
      status: "LOW_RELEVANCE_OVERFLOW",
      source: "lead_promotion_scorer",
      evidence: {
        demote_reason_codes: expect.arrayContaining(["IOS_WIDGET_SCOPE", "UI_COMPONENT_ONLY"]),
        matched_negative_terms: expect.arrayContaining(["ios", "collectionview"])
      }
    });
    expect(downstream.blindScout).toHaveBeenCalledTimes(5);
    expect(downstream.capturer).toHaveBeenCalledTimes(5);
    expect(downstream.blindScout).not.toHaveBeenCalledWith(expect.objectContaining({ repo: "zekunyan/ttgtagcollectionview" }));
    expect(downstream.capturer).not.toHaveBeenCalledWith(expect.objectContaining({ repo: "yamlresume/yamlresume" }));
    expect(downstream.auditor).not.toHaveBeenCalled();
  });

  it("keeps both positive and negative fingerprints when a composite candidate has neutralized score", () => {
    const composite = makeLead({
      repo: "github/composite-chart-typesetter",
      title: "Composite Chart Typesetter",
      deterministic_score: 60,
      description: "A typesetting pipeline embedded in a generic chart library.",
      topics: ["typesetting", "charts"],
      artifact_url_candidates: [],
      readme_digest: [
        "# Composite Chart Typesetter",
        "This project contains a typesetting pipeline for report generation.",
        "It is also a generic chart library for dashboard charts and LineChart components."
      ].join("\n")
    });

    const score = scoreLeadPromotion(composite);

    expect(score.relevance_score).toBe(80);
    expect(score.promote_reason_codes).toEqual(expect.arrayContaining(["TYPESETTING_PIPELINE"]));
    expect(score.demote_reason_codes).toEqual(expect.arrayContaining(["GENERIC_CHART_LIBRARY"]));
    expect(score.matched_positive_terms).toEqual(expect.arrayContaining(["typesetting pipeline"]));
    expect(score.matched_negative_terms).toEqual(expect.arrayContaining(["generic chart library"]));
  });
});
