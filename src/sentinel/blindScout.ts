import { getEncoding } from "js-tiktoken";

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

let cachedDefaultTokenizer: Tokenizer | null = null;

export function getDefaultTokenizer(): Tokenizer {
  if (!cachedDefaultTokenizer) {
    const encoding = getEncoding("cl100k_base");
    cachedDefaultTokenizer = {
      name: "js-tiktoken",
      encode: (input: string) => encoding.encode(input)
    };
  }

  return cachedDefaultTokenizer;
}

export async function runPreflightAnalysis(
  payload: string,
  budget: TokenBudget,
  tokenizer: Tokenizer,
  modelClient: ModelClient
): Promise<unknown> {
  const inputTokenCount = tokenizer.encode(payload).length;
  const projectedDailyTotal = budget.usedDailyTokens + inputTokenCount;

  if (inputTokenCount > budget.maxSinglePayloadTokens) {
    throw new TokenBudgetExceededError(
      `Payload token estimate ${inputTokenCount} exceeds single payload limit ${budget.maxSinglePayloadTokens}`
    );
  }

  if (projectedDailyTotal > budget.maxDailyTokens) {
    throw new TokenBudgetExceededError(
      `Projected daily token estimate ${projectedDailyTotal} exceeds daily limit ${budget.maxDailyTokens}`
    );
  }

  return modelClient.analyze(payload);
}

function isHttp429(error: unknown) {
  return typeof error === "object" && error !== null && (error as { status?: number }).status === 429;
}

export async function runBlindScoutWithRetry(options: ScoutRunOptions): Promise<SourceCandidate[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const candidates = await options.sourceClient.fetchCandidates();
      await options.recordState({ status: "COMPLETED", attempt });
      return candidates;
    } catch (error) {
      lastError = error;

      if (!isHttp429(error) || attempt >= options.maxAttempts) {
        await options.recordState({
          status: "FAILED",
          attempt,
          reason: isHttp429(error) ? "HTTP_429" : "SOURCE_ERROR"
        });
        throw error;
      }

      await options.recordState({ status: "RETRYING", attempt, reason: "HTTP_429" });
      const delayMs = options.backoff.delayForAttempt(attempt);
      await options.backoff.sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Blind scout failed");
}

export function buildTopFiveLeadQueue(options: LeadQueueOptions): {
  selected: SourceCandidate[];
  overflow: SourceCandidate[];
} {
  const allowedCategories = new Set(options.whitelistCategories);
  const blockedRepos = new Set(options.blacklistRepos);
  const ranked = options.candidates
    .filter((candidate) => allowedCategories.has(candidate.category))
    .filter((candidate) => !blockedRepos.has(candidate.repo))
    .sort((left, right) => right.qualityScore - left.qualityScore);

  return {
    selected: ranked.slice(0, options.maxItems),
    overflow: ranked.slice(options.maxItems)
  };
}
