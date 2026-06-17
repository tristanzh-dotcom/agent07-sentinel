export class SourcePlanNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "SourcePlanNotImplementedError";
  }
}

export type SourcePlanV2Intent =
  | "layout_engine"
  | "vector_graphics"
  | "typesetting"
  | "pptx_generation"
  | "document_renderer"
  | "multimodal_artifact";

export type QueryMatrixEntry = {
  id: string;
  intent: SourcePlanV2Intent;
  q: string;
  sort: "updated" | "stars";
  order: "desc";
  page_limit: number;
  per_page: number;
  min_quality_floor: number;
  enabled: boolean;
};

export type SourcePlanV2 = {
  version: 2;
  date: string;
  query_window: {
    pushed_after: string;
    min_stars_default: 100;
    min_stars_fresh_breakout: 20;
  };
  max_candidates_before_blind_scout: number;
  github_query_matrix: QueryMatrixEntry[];
};

export type BuildDefaultSourcePlanV2Input = {
  date: string;
  pushed_after: string;
  min_stars_default: 100;
  min_stars_fresh_breakout: 20;
  max_candidates_before_blind_scout: number;
  topics: Array<"layout-engine" | "vector-graphics" | "typesetting" | "pptx-generation">;
};

export class SourceQueryTooBroadError extends Error {
  constructor(message = "SOURCE_QUERY_TOO_BROAD") {
    super(message);
    this.name = "SourceQueryTooBroadError";
  }
}

const topicIntentMap: Record<BuildDefaultSourcePlanV2Input["topics"][number], SourcePlanV2Intent> = {
  "layout-engine": "layout_engine",
  "vector-graphics": "vector_graphics",
  typesetting: "typesetting",
  "pptx-generation": "pptx_generation"
};

function makeEntry(entry: QueryMatrixEntry): QueryMatrixEntry {
  validateQueryMatrixEntry(entry);
  return entry;
}

function requiredQualityTail(input: BuildDefaultSourcePlanV2Input, stars: number): string {
  return `stars:>${stars} pushed:>${input.pushed_after} archived:false template:false mirror:false is:public`;
}

function canonicalPushedAfter(date: string): string {
  const year = Number.parseInt(date.slice(0, 4), 10);
  if (!Number.isFinite(year)) return "2025-01-01";
  return `${year - 1}-01-01`;
}

function canonicalQualityTail(input: BuildDefaultSourcePlanV2Input): string {
  return `stars:>${input.min_stars_default} pushed:>${canonicalPushedAfter(input.date)} archived:false template:false mirror:false is:public`;
}

export function buildDefaultSourcePlanV2(input: BuildDefaultSourcePlanV2Input): SourcePlanV2 {
  const github_query_matrix: QueryMatrixEntry[] = [];
  const defaultTail = requiredQualityTail(input, input.min_stars_default);
  const freshTail = requiredQualityTail(input, input.min_stars_fresh_breakout);
  const canonicalTail = canonicalQualityTail(input);

  github_query_matrix.push(
    makeEntry({
      id: "readme_pptxgenjs",
      intent: "pptx_generation",
      q: `pptxgenjs in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_powerpoint_generator",
      intent: "pptx_generation",
      q: `"powerpoint generator" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_pptx_automizer",
      intent: "pptx_generation",
      q: `"pptx-automizer" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_react_pptx",
      intent: "pptx_generation",
      q: `"react-pptx" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_markdown_to_pptx",
      intent: "pptx_generation",
      q: `"markdown" "pptx" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_python_pptx_markdown",
      intent: "pptx_generation",
      q: `"python-pptx" "markdown" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "canonical_pptxgenjs",
      intent: "pptx_generation",
      q: `pptxgenjs in:readme ${canonicalTail}`,
      sort: "stars",
      order: "desc",
      page_limit: 1,
      per_page: 30,
      min_quality_floor: 70,
      enabled: true
    }),
    makeEntry({
      id: "canonical_pptx_automizer",
      intent: "pptx_generation",
      q: `"pptx-automizer" in:readme ${canonicalTail}`,
      sort: "stars",
      order: "desc",
      page_limit: 1,
      per_page: 30,
      min_quality_floor: 70,
      enabled: true
    }),
    makeEntry({
      id: "canonical_react_pptx",
      intent: "pptx_generation",
      q: `"react-pptx" in:readme ${canonicalTail}`,
      sort: "stars",
      order: "desc",
      page_limit: 1,
      per_page: 30,
      min_quality_floor: 70,
      enabled: true
    }),
    makeEntry({
      id: "readme_pptx_skill",
      intent: "pptx_generation",
      q: `"pptx" "skill" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_powerpoint_template_layout",
      intent: "pptx_generation",
      q: `"powerpoint" "template" "layout" in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 55,
      enabled: true
    }),
    makeEntry({
      id: "readme_pptx_layout",
      intent: "pptx_generation",
      q: `"pptx" "layout" in:readme ${defaultTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 60,
      enabled: true
    })
  );

  for (const topic of input.topics) {
    github_query_matrix.push(
      makeEntry({
        id: `topic_${topic.replace(/-/g, "_")}`,
        intent: topicIntentMap[topic],
        q: `topic:${topic} ${defaultTail}`,
        sort: "updated",
        order: "desc",
        page_limit: 2,
        per_page: 50,
        min_quality_floor: 55,
        enabled: true
      })
    );
  }

  github_query_matrix.push(
    makeEntry({
      id: "readme_constraint_layout_engine",
      intent: "layout_engine",
      q: `("constraint layout" OR "layout engine") in:readme ${defaultTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 60,
      enabled: true
    }),
    makeEntry({
      id: "readme_pdf_renderer_layout",
      intent: "document_renderer",
      q: `("pdf" "renderer" "layout") in:readme ${defaultTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 2,
      per_page: 50,
      min_quality_floor: 60,
      enabled: true
    }),
    makeEntry({
      id: "fresh_relative_constraint_engine",
      intent: "layout_engine",
      q: `("relative layout" OR "constraint engine") in:readme ${freshTail}`,
      sort: "updated",
      order: "desc",
      page_limit: 1,
      per_page: 30,
      min_quality_floor: 70,
      enabled: true
    })
  );

  return {
    version: 2,
    date: input.date,
    query_window: {
      pushed_after: input.pushed_after,
      min_stars_default: input.min_stars_default,
      min_stars_fresh_breakout: input.min_stars_fresh_breakout
    },
    max_candidates_before_blind_scout: input.max_candidates_before_blind_scout,
    github_query_matrix
  };
}

export function validateQueryMatrixEntry(entry: QueryMatrixEntry): void {
  const query = entry.q.toLowerCase();
  const requiredQualifiers = ["pushed:>", "is:public", "archived:false", "template:false"];

  if (entry.page_limit > 2 || entry.per_page > 50) {
    throw new SourceQueryTooBroadError();
  }

  for (const qualifier of requiredQualifiers) {
    if (!query.includes(qualifier)) {
      throw new SourceQueryTooBroadError();
    }
  }

  const highIntentSignals = [
    "topic:layout-engine",
    "topic:vector-graphics",
    "topic:typesetting",
    "topic:pptx-generation",
    "constraint layout",
    "layout engine",
    `"pptx" "layout"`,
    `"markdown" "pptx"`,
    `"pptx" "skill"`,
    `"powerpoint" "template" "layout"`,
    `"powerpoint generator"`,
    `"pptx-automizer"`,
    `"react-pptx"`,
    "pptxgenjs",
    `"python-pptx" "markdown"`,
    "relative layout",
    "constraint engine",
    "renderer",
    "vector",
    "typesetting"
  ];

  if (!highIntentSignals.some((signal) => query.includes(signal))) {
    throw new SourceQueryTooBroadError();
  }
}
