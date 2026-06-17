export type Agent07ProjectFitReasonCode =
  | "MAINLINE_MARKDOWN_TO_PPTX"
  | "TEMPLATE_LAYOUT_REUSE"
  | "CODEX_SKILL_COMPATIBLE"
  | "EDITABLE_PPTX_OUTPUT"
  | "LOCAL_AUTOMATION_SURFACE";

export type Agent07ProjectFitRiskCode =
  | "SIDE_PATH_PDF_CONVERSION"
  | "STATIC_CONVERTER_ONLY"
  | "TELEGRAM_OR_SERVICE_WRAPPER"
  | "NO_TEMPLATE_CONTROL"
  | "WEAK_MAINTENANCE_SIGNAL";

export type Agent07ProjectFitInput = {
  repo: string;
  title: string;
  description?: string;
  readme_digest?: string;
  readme?: string;
  topics?: string[];
  artifact_url_candidates?: string[];
  artifact_urls?: string[];
  evidence_quality_score?: number;
  deterministic_score?: number;
  qualityScore?: number;
};

export type Agent07ProjectFitScore = {
  repo: string;
  project_fit_score: number;
  evidence_quality_score: number;
  fit_reason_codes: Agent07ProjectFitReasonCode[];
  fit_risk_codes: Agent07ProjectFitRiskCode[];
  matched_positive_terms: string[];
  matched_negative_terms: string[];
};

export type Agent07RecallCoverageInput = {
  displayedCount: number;
  targetCount: number;
};

export type Agent07RecallCoverage = {
  status: "PARTIAL_RECALL" | "READY_FOR_REVIEW";
  displayed_count: number;
  target_count: number;
  blocks_final_approval: boolean;
};

type WeightedTerms<T extends string> = {
  code: T;
  weight: number;
  terms: string[];
};

const POSITIVE_TERMS: WeightedTerms<Agent07ProjectFitReasonCode>[] = [
  {
    code: "MAINLINE_MARKDOWN_TO_PPTX",
    weight: 30,
    terms: ["markdown outlines", "markdown outline", "markdown to pptx", "markdown to powerpoint", "outline to pptx"]
  },
  {
    code: "TEMPLATE_LAYOUT_REUSE",
    weight: 28,
    terms: ["template's actual layouts", "actual layouts", "slide master", "slide masters", "template layouts", "layouts"]
  },
  {
    code: "CODEX_SKILL_COMPATIBLE",
    weight: 24,
    terms: ["codex", "claude code", "openai", "agent automation", "skill"]
  },
  {
    code: "EDITABLE_PPTX_OUTPUT",
    weight: 12,
    terms: ["editable pptx", "editable powerpoint", "pptx presentations", "pptx decks", "powerpoint decks"]
  },
  {
    code: "LOCAL_AUTOMATION_SURFACE",
    weight: 8,
    terms: ["cli", "python", "node", "local", "script"]
  }
];

const NEGATIVE_TERMS: WeightedTerms<Agent07ProjectFitRiskCode>[] = [
  {
    code: "SIDE_PATH_PDF_CONVERSION",
    weight: 18,
    terms: ["pdf to ppt", "pdf2ppt", "pdf2pptx", "convert pdf", "pdf files into editable powerpoint", "transform pdf"]
  },
  {
    code: "STATIC_CONVERTER_ONLY",
    weight: 10,
    terms: ["converter", "conversion workflow", "format conversion"]
  },
  {
    code: "TELEGRAM_OR_SERVICE_WRAPPER",
    weight: 8,
    terms: ["telegram", "bot wrapper", "remote service"]
  },
  {
    code: "NO_TEMPLATE_CONTROL",
    weight: 10,
    terms: ["no template", "without template", "no slide master"]
  },
  {
    code: "WEAK_MAINTENANCE_SIGNAL",
    weight: 8,
    terms: ["toy", "demo only", "not maintained"]
  }
];

function normalizeText(input: Agent07ProjectFitInput) {
  return [
    input.repo,
    input.title,
    input.description,
    input.readme_digest,
    input.readme,
    input.topics?.join(" "),
    input.artifact_url_candidates?.join(" "),
    input.artifact_urls?.join(" ")
  ]
    .filter(Boolean)
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

  return {
    codes,
    terms: Array.from(new Set(terms)),
    delta
  };
}

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evidenceQuality(input: Agent07ProjectFitInput) {
  return numberFrom(input.evidence_quality_score, numberFrom(input.deterministic_score, numberFrom(input.qualityScore, 0)));
}

export function scoreAgent07ProjectFit(input: Agent07ProjectFitInput): Agent07ProjectFitScore {
  const haystack = normalizeText(input);
  const positive = applyTerms(haystack, POSITIVE_TERMS);
  const negative = applyTerms(haystack, NEGATIVE_TERMS);
  const quality = evidenceQuality(input);
  const qualityComponent = Math.max(0, Math.min(20, Math.round(quality / 10)));
  const score = Math.max(0, Math.min(100, 55 + qualityComponent + positive.delta - negative.delta));

  return {
    repo: input.repo,
    project_fit_score: score,
    evidence_quality_score: quality,
    fit_reason_codes: positive.codes,
    fit_risk_codes: negative.codes,
    matched_positive_terms: positive.terms,
    matched_negative_terms: negative.terms
  };
}

export function summarizeAgent07RecallCoverage(input: Agent07RecallCoverageInput): Agent07RecallCoverage {
  const displayedCount = Math.max(0, Math.floor(numberFrom(input.displayedCount, 0)));
  const targetCount = Math.max(1, Math.floor(numberFrom(input.targetCount, 5)));
  const ready = displayedCount >= targetCount;
  return {
    status: ready ? "READY_FOR_REVIEW" : "PARTIAL_RECALL",
    displayed_count: displayedCount,
    target_count: targetCount,
    blocks_final_approval: !ready
  };
}
