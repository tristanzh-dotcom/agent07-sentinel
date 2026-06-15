import { NotImplementedError } from "./storageBase.js";

export class TokenBudgetExceededError extends Error {
  constructor(message = "Token budget exceeded") {
    super(message);
    this.name = "TokenBudgetExceededError";
  }
}

export type Tokenizer = {
  name: "js-tiktoken" | "js-tiktoken-mock";
  encode: (input: string) => ArrayLike<number>;
};

export type TokenBudget = {
  maxSinglePayloadTokens: number;
  maxDailyTokens: number;
  usedDailyTokens: number;
};

export type ModelClient = {
  analyze: (payload: string) => Promise<unknown>;
};

export type SourceCandidate = {
  id: string;
  name: string;
  repo: string;
  category: string;
  readme: string;
  qualityScore: number;
};

export type SourceClient = {
  fetchCandidates: () => Promise<SourceCandidate[]>;
};

export type ScoutStatus = "PENDING" | "RETRYING" | "COMPLETED" | "FAILED";

export type ScoutStateEvent = {
  status: ScoutStatus;
  attempt: number;
  reason?: string;
};

export type BackoffPolicy = {
  delayForAttempt: (attempt: number) => number;
  sleep: (ms: number) => Promise<void>;
};

export type ScoutRunOptions = {
  sourceClient: SourceClient;
  backoff: BackoffPolicy;
  recordState: (event: ScoutStateEvent) => Promise<void> | void;
  maxAttempts: number;
};

export type LeadQueueOptions = {
  candidates: SourceCandidate[];
  whitelistCategories: string[];
  blacklistRepos: string[];
  maxItems: number;
};

export async function runPreflightAnalysis(
  _payload: string,
  _budget: TokenBudget,
  _tokenizer: Tokenizer,
  _modelClient: ModelClient
): Promise<unknown> {
  throw new NotImplementedError("runPreflightAnalysis");
}

export async function runBlindScoutWithRetry(_options: ScoutRunOptions): Promise<SourceCandidate[]> {
  throw new NotImplementedError("runBlindScoutWithRetry");
}

export function buildTopFiveLeadQueue(_options: LeadQueueOptions): {
  selected: SourceCandidate[];
  overflow: SourceCandidate[];
} {
  throw new NotImplementedError("buildTopFiveLeadQueue");
}
