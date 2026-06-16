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
  topics: Array<"layout-engine" | "vector-graphics" | "typesetting">;
};

export class SourceQueryTooBroadError extends Error {
  constructor(message = "SOURCE_QUERY_TOO_BROAD") {
    super(message);
    this.name = "SourceQueryTooBroadError";
  }
}

export function buildDefaultSourcePlanV2(_input: BuildDefaultSourcePlanV2Input): SourcePlanV2 {
  throw new SourcePlanNotImplementedError("buildDefaultSourcePlanV2");
}

export function validateQueryMatrixEntry(_entry: QueryMatrixEntry): void {
  throw new SourcePlanNotImplementedError("validateQueryMatrixEntry");
}

