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
  | "UI_COMPONENT_ONLY";

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

export function scoreLeadPromotion(_input: LeadPromotionInput): LeadPromotionScore {
  throw new LeadPromotionScorerNotImplementedError("scoreLeadPromotion");
}

export function rankLeadPromotionCandidates(
  _inputs: LeadPromotionInput[],
  _options: LeadPromotionRankingOptions
): LeadPromotionRankingResult {
  throw new LeadPromotionScorerNotImplementedError("rankLeadPromotionCandidates");
}
