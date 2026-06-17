export type Agent07ProjectFitReasonCode =
  | "MAINLINE_MARKDOWN_TO_PPTX"
  | "HTML_TO_PPTX_GENERATION"
  | "POWERPOINT_GENERATION_LIBRARY"
  | "TEMPLATE_LAYOUT_REUSE"
  | "CODEX_SKILL_COMPATIBLE"
  | "EDITABLE_PPTX_OUTPUT"
  | "LOCAL_AUTOMATION_SURFACE";

export type Agent07ProjectFitRiskCode =
  | "SIDE_PATH_PDF_CONVERSION"
  | "STATIC_CONVERTER_ONLY"
  | "TELEGRAM_OR_SERVICE_WRAPPER"
  | "NO_TEMPLATE_CONTROL"
  | "WEAK_MAINTENANCE_SIGNAL"
  | "MOBILE_UI_LAYOUT_ONLY"
  | "VECTOR_GRAPHICS_EDITOR_ONLY"
  | "TERMINAL_OR_DESKTOP_UI_ONLY"
  | "MINECRAFT_MOD_ONLY"
  | "NO_PRESENTATION_GENERATION_SIGNAL"
  | "VIEWER_ONLY_NO_GENERATION"
  | "COLLECTION_OR_AWESOME_LIST"
  | "CLASSROOM_OR_AGENT_PLATFORM";

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
    code: "HTML_TO_PPTX_GENERATION",
    weight: 20,
    terms: ["dom-to-pptx", "html to pptx", "html element into a fully editable powerpoint", "html element into a fully editable powerpoint slide"]
  },
  {
    code: "POWERPOINT_GENERATION_LIBRARY",
    weight: 35,
    terms: [
      "build powerpoint presentations",
      "create powerpoint presentations",
      "generate powerpoint",
      "powerpoint generator",
      "pptx generator",
      "pptx generation",
      "pptx-automizer",
      "react-pptx",
      "json-to-pptx",
      "generate professional .docx and .pptx files",
      "pptx files from json",
      "render them into real office documents",
      "html-to-ppt",
      "ppt maker",
      "presentation-ppt-maker",
      "slide image to editable pptx",
      "markdown to powerpoint",
      "markdown to pptx"
    ]
  },
  {
    code: "TEMPLATE_LAYOUT_REUSE",
    weight: 28,
    terms: ["template's actual layouts", "actual layouts", "slide master", "slide masters", "template layouts", "powerpoint template"]
  },
  {
    code: "CODEX_SKILL_COMPATIBLE",
    weight: 24,
    terms: ["codex", "claude code", "openai", "agent automation", "skill package"]
  },
  {
    code: "EDITABLE_PPTX_OUTPUT",
    weight: 12,
    terms: ["editable pptx", "editable powerpoint", "pptx presentations", "pptx decks", "powerpoint decks"]
  },
  {
    code: "LOCAL_AUTOMATION_SURFACE",
    weight: 4,
    terms: ["command-line", "cli", "python api", "node api", "local api"]
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
    terms: ["converter", "conversion workflow", "format conversion", "image-based", "image based", "html decks to pdf", "pdf + pptx", "offline presentations"]
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
  },
  {
    code: "COLLECTION_OR_AWESOME_LIST",
    weight: 40,
    terms: ["awesome-", "awesome ", "curated list", "curated ai coding agent skills", "bundles reusable skills", "reusable skills", "playbooks"]
  },
  {
    code: "CLASSROOM_OR_AGENT_PLATFORM",
    weight: 35,
    terms: ["classroom", "multi-agent learning", "multi-agent classroom", "ai teachers", "quizzes", "simulations", "context graph", "governance"]
  },
  {
    code: "MOBILE_UI_LAYOUT_ONLY",
    weight: 25,
    terms: ["ios", "uikit", "swiftui", "react native", "android", "mobile ui"]
  },
  {
    code: "VECTOR_GRAPHICS_EDITOR_ONLY",
    weight: 25,
    terms: ["vector paint", "vector graphics editor", "paint program", "2d content creation", "pixel art"]
  },
  {
    code: "TERMINAL_OR_DESKTOP_UI_ONLY",
    weight: 20,
    terms: ["terminal apps", "window manager", "desktop gui framework"]
  },
  {
    code: "MINECRAFT_MOD_ONLY",
    weight: 25,
    terms: ["minecraft mod", "minecraft"]
  },
  {
    code: "VIEWER_ONLY_NO_GENERATION",
    weight: 35,
    terms: ["viewer", "renders to an html canvas", "renders to a canvas", "view documents", "document viewer"]
  }
];

const PRESENTATION_GENERATION_TERMS = ["pptx", "powerpoint", "slides", "slide", "presentation", "presentations", "deck", "decks"];
const DIRECT_PRESENTATION_CAPABILITY_CODES: Agent07ProjectFitReasonCode[] = [
  "MAINLINE_MARKDOWN_TO_PPTX",
  "HTML_TO_PPTX_GENERATION",
  "POWERPOINT_GENERATION_LIBRARY",
  "TEMPLATE_LAYOUT_REUSE",
  "EDITABLE_PPTX_OUTPUT"
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

function tokenize(haystack: string) {
  return new Set(haystack.split(/[^a-z0-9+#.-]+/).filter(Boolean));
}

function isShortTokenTerm(term: string) {
  return /^[a-z0-9+#.-]+$/.test(term) && term.length <= 4;
}

function termMatches(haystack: string, tokens: Set<string>, term: string) {
  if (isShortTokenTerm(term)) return tokens.has(term);
  return haystack.includes(term);
}

function applyTerms<T extends string>(haystack: string, groups: WeightedTerms<T>[]) {
  const tokens = tokenize(haystack);
  const codes: T[] = [];
  const terms: string[] = [];
  let delta = 0;

  for (const group of groups) {
    const matched = group.terms.filter((term) => termMatches(haystack, tokens, term));
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
  return Math.max(0, Math.min(100, numberFrom(input.evidence_quality_score, numberFrom(input.deterministic_score, numberFrom(input.qualityScore, 0)))));
}

function hasCode<T extends string>(codes: T[], code: T) {
  return codes.includes(code);
}

function applyProjectFitCaps(input: {
  score: number;
  reasonCodes: Agent07ProjectFitReasonCode[];
  riskCodes: Agent07ProjectFitRiskCode[];
  hasPresentationSignal: boolean;
  hasDirectPresentationCapability: boolean;
}) {
  let score = input.score;
  const reasonCodes = input.reasonCodes;
  const riskCodes = input.riskCodes;
  const hasMainline = hasCode(reasonCodes, "MAINLINE_MARKDOWN_TO_PPTX");
  const hasHtml = hasCode(reasonCodes, "HTML_TO_PPTX_GENERATION");
  const hasLibrary = hasCode(reasonCodes, "POWERPOINT_GENERATION_LIBRARY");
  const hasTemplate = hasCode(reasonCodes, "TEMPLATE_LAYOUT_REUSE");
  const hasSkill = hasCode(reasonCodes, "CODEX_SKILL_COMPATIBLE");
  const hasEditable = hasCode(reasonCodes, "EDITABLE_PPTX_OUTPUT");
  const hasCoreGenerationPath = hasMainline || hasHtml || hasLibrary || hasTemplate;
  const isGenericLibraryOnly = hasLibrary && !hasMainline && !hasHtml && !hasTemplate && !hasEditable;

  if (input.hasPresentationSignal && !input.hasDirectPresentationCapability) score = Math.min(score, 55);
  if (hasEditable && !hasCoreGenerationPath) score = Math.min(score, 88);
  if (isGenericLibraryOnly) {
    score = Math.min(score, hasSkill ? 92 : 88);
  }
  if (hasHtml && hasEditable && !hasTemplate && !hasMainline) score = Math.min(score, 90);
  if (hasLibrary && hasSkill && hasEditable && !hasMainline && !hasTemplate) score = Math.min(score, 97);

  if (riskCodes.includes("STATIC_CONVERTER_ONLY")) score = Math.min(score, 84);
  if (riskCodes.includes("SIDE_PATH_PDF_CONVERSION")) score = Math.min(score, 76);
  if (riskCodes.includes("NO_TEMPLATE_CONTROL")) score = Math.min(score, 86);
  if (riskCodes.includes("VIEWER_ONLY_NO_GENERATION")) score = Math.min(score, 55);
  if (riskCodes.includes("COLLECTION_OR_AWESOME_LIST")) score = Math.min(score, 55);
  if (riskCodes.includes("CLASSROOM_OR_AGENT_PLATFORM")) score = Math.min(score, 60);
  if (riskCodes.includes("NO_PRESENTATION_GENERATION_SIGNAL")) score = Math.min(score, 55);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreAgent07ProjectFit(input: Agent07ProjectFitInput): Agent07ProjectFitScore {
  const haystack = normalizeText(input);
  const positive = applyTerms(haystack, POSITIVE_TERMS);
  const negative = applyTerms(haystack, NEGATIVE_TERMS);
  const quality = evidenceQuality(input);
  const qualityComponent = Math.max(0, Math.min(20, Math.round(quality / 10)));
  const hasPresentationSignal = PRESENTATION_GENERATION_TERMS.some((term) => haystack.includes(term));
  const fitRiskCodes = hasPresentationSignal ? negative.codes : [...negative.codes, "NO_PRESENTATION_GENERATION_SIGNAL" as const];
  const rawScore = Math.max(0, Math.min(100, 55 + qualityComponent + positive.delta - negative.delta));
  const hasDirectPresentationCapability = positive.codes.some((code) => DIRECT_PRESENTATION_CAPABILITY_CODES.includes(code));
  const preCapScore = hasPresentationSignal ? rawScore : Math.min(rawScore, 55);
  const score = applyProjectFitCaps({
    score: preCapScore,
    reasonCodes: positive.codes,
    riskCodes: Array.from(new Set(fitRiskCodes)),
    hasPresentationSignal,
    hasDirectPresentationCapability
  });

  return {
    repo: input.repo,
    project_fit_score: score,
    evidence_quality_score: quality,
    fit_reason_codes: positive.codes,
    fit_risk_codes: Array.from(new Set(fitRiskCodes)),
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
