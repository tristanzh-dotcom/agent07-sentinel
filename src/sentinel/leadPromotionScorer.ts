export class LeadPromotionScorerNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "LeadPromotionScorerNotImplementedError";
  }
}

export type LeadPromoteReasonCode =
  | "DOCUMENT_LAYOUT_ENGINE"
  | "GLYPH_COORDINATE_OUTPUT"
  | "DETERMINISTIC_PAGINATION"
  | "TYPESETTING_PIPELINE"
  | "REPORT_GENERATION"
  | "VECTOR_CANVAS_RENDERING"
  | "PPT_OR_SLIDE_EXPORT"
  | "MAINLINE_MARKDOWN_TO_PPTX"
  | "TEMPLATE_LAYOUT_REUSE"
  | "AGENT_SKILL_COMPATIBLE"
  | "MULTIMODAL_ARTIFACT_OUTPUT"
  | "VISUAL_ARTIFACT_BONUS"
  | "HIGH_INTENT_TOPIC_BONUS"
  | "ARCHITECTURE_WITH_VISUAL_EXAMPLE_BONUS";

export type LeadDemoteReasonCode =
  | "RESUME_ONLY_NARROWNESS"
  | "IOS_WIDGET_SCOPE"
  | "GENERIC_CHART_LIBRARY"
  | "AWESOME_LIST_OR_INDEX"
  | "TASK_APP_OR_DEMO_APP"
  | "MCP_DIRECTORY_ONLY"
  | "UI_COMPONENT_ONLY"
  | "SIDE_PATH_PDF_CONVERSION"
  | "TELEGRAM_OR_SERVICE_WRAPPER";

export type LeadPromotionInput = {
  repo: string;
  title: string;
  category: string;
  readme_digest: string;
  description: string;
  topics: string[];
  deterministic_score: number;
  artifact_url_candidates: string[];
};

export type LeadPromotionScore = {
  repo: string;
  relevance_score: number;
  base_quality_score: number;
  promote_reason_codes: LeadPromoteReasonCode[];
  demote_reason_codes: LeadDemoteReasonCode[];
  matched_positive_terms: string[];
  matched_negative_terms: string[];
  decision: "PROMOTE_CANDIDATE" | "LOW_RELEVANCE_OVERFLOW";
};

export type PromotedLead = LeadPromotionInput & {
  promotion: LeadPromotionScore;
};

export type LowRelevanceOverflowEntry = {
  repo: string;
  status: "LOW_RELEVANCE_OVERFLOW";
  source: "lead_promotion_scorer";
  captured_at: string;
  evidence: LeadPromotionScore;
};

export type LeadPromotionRankingResult = {
  promoted: PromotedLead[];
  low_relevance_overflow: Record<string, LowRelevanceOverflowEntry>;
};

export type LeadPromotionRankingOptions = {
  maxPromoted: 5;
  promotedFloor: number;
  now: () => Date;
};

type WeightedTerms<T extends string> = {
  code: T;
  weight: number;
  terms: string[];
};

const PROMOTION_TERMS: WeightedTerms<LeadPromoteReasonCode>[] = [
  {
    code: "DOCUMENT_LAYOUT_ENGINE",
    weight: 50,
    terms: ["deterministic layout engine", "document layout engine", "page layout engine", "layout engine"]
  },
  {
    code: "GLYPH_COORDINATE_OUTPUT",
    weight: 50,
    terms: ["glyph coordinates", "text run coordinates", "box coordinates", "positioned primitives", "flat layout data"]
  },
  {
    code: "DETERMINISTIC_PAGINATION",
    weight: 50,
    terms: ["deterministic pagination", "pagination", "page breaks", "table of contents", "widow", "orphan"]
  },
  {
    code: "TYPESETTING_PIPELINE",
    weight: 50,
    terms: ["typesetting pipeline", "typesetting", "typst", "latex"]
  },
  {
    code: "REPORT_GENERATION",
    weight: 35,
    terms: ["document generation", "pdf generation", "pdf export", "markdown to pdf"]
  },
  {
    code: "VECTOR_CANVAS_RENDERING",
    weight: 30,
    terms: ["canvas vector", "vector graphics", "rendering pipeline", "svg", "canvas"]
  },
  {
    code: "PPT_OR_SLIDE_EXPORT",
    weight: 35,
    terms: ["powerpoint", "pptx", "slide generation", "presentation generation", "deck export"]
  },
  {
    code: "MAINLINE_MARKDOWN_TO_PPTX",
    weight: 50,
    terms: ["markdown outlines", "markdown outline", "markdown to pptx", "markdown to powerpoint", "outline to pptx"]
  },
  {
    code: "TEMPLATE_LAYOUT_REUSE",
    weight: 40,
    terms: ["template's actual layouts", "actual layouts", "slide master", "slide masters", "template layouts"]
  },
  {
    code: "AGENT_SKILL_COMPATIBLE",
    weight: 20,
    terms: ["codex", "claude code", "openai", "agent automation", "skill package"]
  },
  {
    code: "MULTIMODAL_ARTIFACT_OUTPUT",
    weight: 20,
    terms: ["visual previews", "preview gallery", "generated assets", "screenshot", "showcase"]
  }
];

const DEMOTION_TERMS: WeightedTerms<LeadDemoteReasonCode>[] = [
  {
    code: "RESUME_ONLY_NARROWNESS",
    weight: 80,
    terms: ["resume", "cv builder", "curriculum vitae", "jsonresume", "yaml resume", "resume template"]
  },
  {
    code: "IOS_WIDGET_SCOPE",
    weight: 80,
    terms: ["ios", "swiftui", "uikit", "cocoapods", "collectionview", "ios widget"]
  },
  {
    code: "GENERIC_CHART_LIBRARY",
    weight: 30,
    terms: ["generic chart library", "chart library", "dashboard charts", "linechart", "barchart"]
  },
  {
    code: "AWESOME_LIST_OR_INDEX",
    weight: 45,
    terms: ["awesome list", "curated list", "resources list"]
  },
  {
    code: "TASK_APP_OR_DEMO_APP",
    weight: 40,
    terms: ["todo app", "task app", "demo app", "example app", "starter template", "boilerplate"]
  },
  {
    code: "MCP_DIRECTORY_ONLY",
    weight: 35,
    terms: ["mcp directory", "server directory", "agent directory"]
  },
  {
    code: "UI_COMPONENT_ONLY",
    weight: 30,
    terms: ["tag component", "ui widget", "mobile component", "component library", "collectionview"]
  },
  {
    code: "SIDE_PATH_PDF_CONVERSION",
    weight: 60,
    terms: ["pdf to ppt", "pdf2ppt", "pdf2pptx", "convert pdf", "pdf files into editable powerpoint", "transform pdf"]
  },
  {
    code: "TELEGRAM_OR_SERVICE_WRAPPER",
    weight: 20,
    terms: ["telegram", "bot wrapper", "remote service"]
  }
];

function scoreText(input: LeadPromotionInput) {
  return [
    input.repo,
    input.title,
    input.category,
    input.description,
    input.topics.join(" "),
    input.readme_digest,
    input.artifact_url_candidates.join(" ")
  ]
    .join("\n")
    .toLowerCase();
}

function applyTerms<T extends string>(haystack: string, groups: WeightedTerms<T>[]) {
  const codes: T[] = [];
  const terms: string[] = [];
  let delta = 0;

  for (const group of groups) {
    const matched = group.terms.filter((term) => haystack.includes(term));
    if (matched.length === 0) continue;
    codes.push(group.code);
    terms.push(...matched);
    delta += group.weight;
  }

  return { codes, terms: Array.from(new Set(terms)), delta };
}

function scoreDecision(score: number): LeadPromotionScore["decision"] {
  return score >= 60 ? "PROMOTE_CANDIDATE" : "LOW_RELEVANCE_OVERFLOW";
}

function withDecision(score: LeadPromotionScore, decision: LeadPromotionScore["decision"]): LeadPromotionScore {
  return {
    ...score,
    decision
  };
}

export function scoreLeadPromotion(input: LeadPromotionInput): LeadPromotionScore {
  const haystack = scoreText(input);
  const promotion = applyTerms(haystack, PROMOTION_TERMS);
  const demotion = applyTerms(haystack, DEMOTION_TERMS);
  const relevanceScore = Math.max(0, Math.min(200, input.deterministic_score + promotion.delta - demotion.delta));

  return {
    repo: input.repo,
    relevance_score: relevanceScore,
    base_quality_score: input.deterministic_score,
    promote_reason_codes: promotion.codes,
    demote_reason_codes: demotion.codes,
    matched_positive_terms: promotion.terms,
    matched_negative_terms: demotion.terms,
    decision: scoreDecision(relevanceScore)
  };
}

export function rankLeadPromotionCandidates(
  inputs: LeadPromotionInput[],
  options: LeadPromotionRankingOptions
): LeadPromotionRankingResult {
  const ranked = inputs
    .map((input, index) => ({
      input,
      index,
      score: scoreLeadPromotion(input)
    }))
    .sort((left, right) => {
      if (right.score.relevance_score !== left.score.relevance_score) {
        return right.score.relevance_score - left.score.relevance_score;
      }
      return left.index - right.index;
    });

  const promoted: PromotedLead[] = [];
  const lowRelevanceOverflow: Record<string, LowRelevanceOverflowEntry> = {};

  for (const entry of ranked) {
    const canPromote = promoted.length < options.maxPromoted && entry.score.relevance_score >= options.promotedFloor;
    if (canPromote) {
      promoted.push({
        ...entry.input,
        promotion: withDecision(entry.score, "PROMOTE_CANDIDATE")
      });
      continue;
    }

    lowRelevanceOverflow[entry.input.repo] = {
      repo: entry.input.repo,
      status: "LOW_RELEVANCE_OVERFLOW",
      source: "lead_promotion_scorer",
      captured_at: options.now().toISOString(),
      evidence: withDecision(entry.score, "LOW_RELEVANCE_OVERFLOW")
    };
  }

  return {
    promoted,
    low_relevance_overflow: lowRelevanceOverflow
  };
}
