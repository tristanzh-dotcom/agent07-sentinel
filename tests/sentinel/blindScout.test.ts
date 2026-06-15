import { describe, expect, it, vi } from "vitest";
import {
  buildTopFiveLeadQueue,
  runBlindScoutWithRetry,
  runPreflightAnalysis,
  SourceCandidate,
  TokenBudgetExceededError,
  Tokenizer
} from "../../src/sentinel/blindScout.js";

function makeCandidate(index: number, overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    id: `repo-${index}`,
    name: `Repo ${index}`,
    repo: `owner/repo-${index}`,
    category: "frontend_framework",
    readme: "generic frontend framework",
    qualityScore: index,
    ...overrides
  };
}

describe("Milestone 2 Blind Scout TDD contract", () => {
  it("blocks oversized payloads with TokenBudgetExceededError before any model request", async () => {
    const hugeReadme = "layout-token ".repeat(50_000);
    const tokenizer: Tokenizer = {
      name: "js-tiktoken-mock",
      encode: vi.fn(() => Array.from({ length: 50_000 }, (_, index) => index))
    };
    const modelClient = {
      analyze: vi.fn(async () => ({ ok: true }))
    };

    await expect(
      runPreflightAnalysis(
        hugeReadme,
        {
          maxSinglePayloadTokens: 10_000,
          maxDailyTokens: 20_000,
          usedDailyTokens: 0
        },
        tokenizer,
        modelClient
      )
    ).rejects.toBeInstanceOf(TokenBudgetExceededError);

    expect(tokenizer.encode).toHaveBeenCalledWith(hugeReadme);
    expect(modelClient.analyze).not.toHaveBeenCalled();
  });

  it("records RETRYING during HTTP 429 exponential backoff and completes on the third attempt", async () => {
    const successfulCandidates = [
      makeCandidate(1, {
        category: "advanced_ppt",
        readme: "credible multimodal PPT layout tool",
        qualityScore: 100
      })
    ];
    const tooManyRequests = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const sourceClient = {
      fetchCandidates: vi
        .fn()
        .mockRejectedValueOnce(tooManyRequests)
        .mockRejectedValueOnce(tooManyRequests)
        .mockResolvedValueOnce(successfulCandidates)
    };
    const backoff = {
      delayForAttempt: vi.fn((attempt: number) => 2 ** attempt * 100),
      sleep: vi.fn(async () => undefined)
    };
    const stateEvents: Array<{ status: string; attempt: number; reason?: string }> = [];

    const result = await runBlindScoutWithRetry({
      sourceClient,
      backoff,
      recordState: (event) => {
        stateEvents.push(event);
      },
      maxAttempts: 3
    });

    expect(result).toEqual(successfulCandidates);
    expect(sourceClient.fetchCandidates).toHaveBeenCalledTimes(3);
    expect(backoff.delayForAttempt).toHaveBeenNthCalledWith(1, 1);
    expect(backoff.delayForAttempt).toHaveBeenNthCalledWith(2, 2);
    expect(backoff.sleep).toHaveBeenNthCalledWith(1, 200);
    expect(backoff.sleep).toHaveBeenNthCalledWith(2, 400);
    expect(stateEvents).toEqual([
      { status: "RETRYING", attempt: 1, reason: "HTTP_429" },
      { status: "RETRYING", attempt: 2, reason: "HTTP_429" },
      { status: "COMPLETED", attempt: 3 }
    ]);
  });

  it("filters mixed technical sources to exactly five high-productivity layout leads", () => {
    const irrelevant = Array.from({ length: 14 }, (_, index) =>
      makeCandidate(index, {
        category: index % 2 === 0 ? "frontend_framework" : "cli_toy",
        readme: "generic small tool",
        qualityScore: 10 + index
      })
    );
    const highProductivity = Array.from({ length: 6 }, (_, index) =>
      makeCandidate(100 + index, {
        category: index % 2 === 0 ? "multimodal_layout" : "advanced_ppt",
        readme: "high quality multimodal layout and premium PPT generation",
        qualityScore: 100 - index
      })
    );

    const queue = buildTopFiveLeadQueue({
      candidates: [...irrelevant, ...highProductivity],
      whitelistCategories: ["multimodal_layout", "advanced_ppt", "svg_synthesis", "magazine_composition"],
      blacklistRepos: ["owner/repo-102"],
      maxItems: 5
    });

    expect(queue.selected).toHaveLength(5);
    expect(queue.selected.every((item) => ["multimodal_layout", "advanced_ppt"].includes(item.category))).toBe(true);
    expect(queue.selected.map((item) => item.repo)).not.toContain("owner/repo-102");
    expect(queue.overflow).toHaveLength(0);
    expect(queue.selected.map((item) => item.qualityScore)).toEqual([100, 99, 97, 96, 95]);
  });
});
