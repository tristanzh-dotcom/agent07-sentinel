# Project Sentinel v3 Local MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first local Project Sentinel slice inside `/Users/tristanzh/agent/Git-Scout`: typed JSON contracts, event/checkpoint state, token circuit breaker, blacklist-aware daily queue, and a minimal local dashboard for TZ approve/reject decisions.

**Architecture:** The MVP is file-first and model-free. It uses fixture candidates instead of live GitHub/RSS fetching, and fake audit clients instead of real strong-model calls, so the hard boundaries are proven before any external API or paid token path exists.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, Zod, local JSON/JSONL files, static HTML/CSS/JS served by a small Node HTTP server.

---

## Scope

This plan implements the first testable vertical slice from the approved SDD:

- Candidate, gate decision, audit job, audit report, and event schemas.
- Atomic JSON and JSONL persistence.
- Legal state transitions and checkpoint rebuild from events.
- Token budget reservation and reconciliation.
- Audit runner guardrails that refuse raw/unbounded input and skip calls when budget is exhausted.
- Blacklist filtering and exactly-five daily candidate queue from local fixtures.
- Local dark dashboard with approve/reject actions.
- CLI commands for seed, serve, and audit dry-run.

This plan does not implement live GitHub/RSS fetching, real model provider calls, launchd scheduling, browser screenshot extraction, or publication to `/Users/tristanzh/agent/web`.

## File Structure

- Create `package.json`: scripts and dependencies for the local TypeScript app.
- Create `tsconfig.json`: TypeScript compiler settings.
- Create `vitest.config.ts`: unit and integration test runner configuration.
- Create `src/schemas/sentinel.ts`: all Zod schemas and inferred TypeScript types.
- Create `src/core/atomicFiles.ts`: atomic JSON and JSONL file writes.
- Create `src/core/events.ts`: event append, checkpoint rebuild, legal transition enforcement.
- Create `src/core/budgetLedger.ts`: daily token budget reservation and reconciliation.
- Create `src/audit/auditRunner.ts`: strong-audit guardrail runner with injected fake model client.
- Create `src/scout/dailyQueue.ts`: fixture-based candidate filtering and exactly-five queue creation.
- Create `src/dashboard/server.ts`: local HTTP server and schema-validated decision endpoints.
- Create `src/cli.ts`: `seed`, `serve`, and `audit-dry-run` commands.
- Create `public/index.html`, `public/app.js`, `public/styles.css`: dashboard UI.
- Create `fixtures/raw-candidates.json`: deterministic local scout input.
- Create tests under `tests/` matching each module.

## Task 1: Scaffold Local TypeScript Project

**Files:**
- Create: `/Users/tristanzh/agent/Git-Scout/package.json`
- Create: `/Users/tristanzh/agent/Git-Scout/tsconfig.json`
- Create: `/Users/tristanzh/agent/Git-Scout/vitest.config.ts`
- Create: `/Users/tristanzh/agent/Git-Scout/src/cli.ts`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/smoke.test.ts
import { describe, expect, it } from "vitest";
import { appName } from "../src/cli";

describe("Git-Scout scaffold", () => {
  it("exports the local app name", () => {
    expect(appName).toBe("Project Sentinel v3");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/smoke.test.ts
```

Expected: FAIL because `package.json` and `src/cli.ts` do not exist.

- [ ] **Step 3: Create the minimal project scaffold**

```json
// /Users/tristanzh/agent/Git-Scout/package.json
{
  "name": "git-scout",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "dev": "tsx src/cli.ts",
    "seed": "tsx src/cli.ts seed",
    "serve": "tsx src/cli.ts serve",
    "audit:dry-run": "tsx src/cli.ts audit-dry-run"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

```json
// /Users/tristanzh/agent/Git-Scout/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

```ts
// /Users/tristanzh/agent/Git-Scout/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

```ts
// /Users/tristanzh/agent/Git-Scout/src/cli.ts
export const appName = "Project Sentinel v3";

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(appName);
}
```

- [ ] **Step 4: Install dependencies and verify the smoke test passes**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm install
npm test -- tests/smoke.test.ts
npm run typecheck
```

Expected: both test and typecheck pass.

- [ ] **Step 5: Commit scaffold**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add package.json package-lock.json tsconfig.json vitest.config.ts src/cli.ts tests/smoke.test.ts
git commit -m "chore(sentinel): scaffold local typescript app"
```

## Task 2: Define JSON Contracts With Zod

**Files:**
- Create: `/Users/tristanzh/agent/Git-Scout/src/schemas/sentinel.ts`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/schemas/sentinel.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/schemas/sentinel.test.ts
import { describe, expect, it } from "vitest";
import { AuditJobSchema, CandidateSchema, GateDecisionSchema } from "../../src/schemas/sentinel";

describe("Sentinel schemas", () => {
  it("accepts a valid candidate", () => {
    const parsed = CandidateSchema.parse({
      id: "github:owner/repo:2026-06-14",
      source: { kind: "github", url: "https://github.com/owner/repo", fetched_at: "2026-06-14T08:00:00+08:00" },
      repo: { owner: "owner", name: "repo", stars: 1234, language: "TypeScript", license: "MIT" },
      scout: {
        category: "multimodal_layout",
        keep_reason: "Generates editable PPT assets.",
        reject_risk: "May be a prompt wrapper.",
        estimated_token_roi: 0.42,
        aesthetic_prior: 0.78,
        confidence: 0.71
      },
      artifacts: [{ kind: "image", source_url: "https://example.com/sample.png", local_path: "data/artifacts/sample.png", sha256: "abc" }],
      state: "awaiting_tz_gate"
    });

    expect(parsed.repo.owner).toBe("owner");
  });

  it("rejects invalid gate decisions", () => {
    expect(() =>
      GateDecisionSchema.parse({
        candidate_id: "github:owner/repo:2026-06-14",
        decision: "maybe",
        decided_by: "TZ",
        decided_at: "2026-06-14T08:10:00+08:00",
        notes: "",
        blacklist: null
      })
    ).toThrow();
  });

  it("accepts bounded audit jobs", () => {
    const parsed = AuditJobSchema.parse({
      job_id: "audit:owner/repo:2026-06-14",
      candidate_id: "github:owner/repo:2026-06-14",
      input_pack: {
        readme_digest_path: "data/audits/owner-repo/readme.digest.md",
        file_tree_path: "data/audits/owner-repo/file-tree.json",
        selected_snippets_path: "data/audits/owner-repo/snippets.json",
        artifact_index_path: "data/audits/owner-repo/artifacts.json"
      },
      budget: { max_input_tokens: 18000, max_output_tokens: 4000, daily_budget_key: "2026-06-14" },
      state: "queued"
    });

    expect(parsed.budget.max_output_tokens).toBe(4000);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/schemas/sentinel.test.ts
```

Expected: FAIL because `src/schemas/sentinel.ts` does not exist.

- [ ] **Step 3: Implement schemas**

```ts
// /Users/tristanzh/agent/Git-Scout/src/schemas/sentinel.ts
import { z } from "zod";

export const CandidateStateSchema = z.enum([
  "discovered",
  "metadata_fetched",
  "cheap_classified",
  "assets_cached",
  "awaiting_tz_gate",
  "rejected_terminal",
  "approved_for_audit",
  "audit_pack_prepared",
  "audit_budget_reserved",
  "audit_running",
  "audit_complete",
  "failed_retryable",
  "failed_terminal"
]);

export const ArtifactSchema = z.object({
  kind: z.enum(["image", "pdf_preview", "html_preview"]),
  source_url: z.string().url(),
  local_path: z.string().min(1),
  sha256: z.string().min(1)
});

export const CandidateSchema = z.object({
  id: z.string().min(1),
  source: z.object({
    kind: z.enum(["github", "rss", "curated"]),
    url: z.string().url(),
    fetched_at: z.string().min(1)
  }),
  repo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    stars: z.number().int().nonnegative(),
    language: z.string().nullable(),
    license: z.string().nullable()
  }),
  scout: z.object({
    category: z.enum(["multimodal_layout", "advanced_document_layout", "svg_synthesis", "ppt_generation", "magazine_composition"]),
    keep_reason: z.string().min(1),
    reject_risk: z.string().min(1),
    estimated_token_roi: z.number().min(0).max(1),
    aesthetic_prior: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1)
  }),
  artifacts: z.array(ArtifactSchema),
  state: CandidateStateSchema
});

export const GateDecisionSchema = z.object({
  candidate_id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  decided_by: z.literal("TZ"),
  decided_at: z.string().min(1),
  notes: z.string(),
  blacklist: z
    .object({
      repo: z.string().min(1).nullable(),
      owner: z.string().min(1).nullable(),
      reason: z.string().min(1)
    })
    .nullable()
});

export const AuditJobSchema = z.object({
  job_id: z.string().min(1),
  candidate_id: z.string().min(1),
  input_pack: z.object({
    readme_digest_path: z.string().min(1),
    file_tree_path: z.string().min(1),
    selected_snippets_path: z.string().min(1),
    artifact_index_path: z.string().min(1)
  }),
  budget: z.object({
    max_input_tokens: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    daily_budget_key: z.string().min(1)
  }),
  state: z.enum(["queued", "audit_budget_reserved", "audit_running", "audit_complete", "failed_retryable", "failed_terminal"])
});

export const AuditReportSchema = z.object({
  job_id: z.string().min(1),
  candidate_id: z.string().min(1),
  verdict: z.enum(["adopt", "watch", "reject", "sandbox_only"]),
  confidence: z.number().min(0).max(1),
  findings: z.array(
    z.object({
      metric: z.enum(["authenticity", "hot_swap_friction", "boundary_robustness", "token_roi"]),
      score: z.number().min(0).max(1),
      claim: z.string().min(1),
      evidence_path: z.string().min(1)
    })
  ),
  integration: z.object({
    surface: z.enum(["local_cli", "library", "mcp_server", "web_dashboard", "none"]),
    hot_swap_friction: z.number().min(0).max(1),
    pollution_risk: z.enum(["low", "medium", "high"])
  }),
  next_experiment: z.string().min(1)
});

export const SentinelEventSchema = z.object({
  type: z.string().min(1),
  entity_id: z.string().min(1).optional(),
  at: z.string().min(1),
  payload: z.record(z.unknown()).default({})
});

export type Candidate = z.infer<typeof CandidateSchema>;
export type GateDecision = z.infer<typeof GateDecisionSchema>;
export type AuditJob = z.infer<typeof AuditJobSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type SentinelEvent = z.infer<typeof SentinelEventSchema>;
export type CandidateState = z.infer<typeof CandidateStateSchema>;
```

- [ ] **Step 4: Verify schemas**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/schemas/sentinel.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit schemas**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add src/schemas/sentinel.ts tests/schemas/sentinel.test.ts
git commit -m "feat(sentinel): define json contracts"
```

## Task 3: Implement Event Log, Checkpoint, and Legal Transitions

**Files:**
- Create: `/Users/tristanzh/agent/Git-Scout/src/core/atomicFiles.ts`
- Create: `/Users/tristanzh/agent/Git-Scout/src/core/events.ts`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/core/events.test.ts`

- [ ] **Step 1: Write failing checkpoint tests**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/core/events.test.ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEvent, readCheckpointOrRebuild } from "../../src/core/events";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-events-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("event checkpoint state", () => {
  it("applies legal transitions and writes valid checkpoint json", async () => {
    await applyEvent(root, { type: "candidate_discovered", entity_id: "c1", at: "2026-06-14T00:00:00Z", payload: {} });
    await applyEvent(root, { type: "candidate_metadata_fetched", entity_id: "c1", at: "2026-06-14T00:00:01Z", payload: {} });

    const checkpoint = await readCheckpointOrRebuild(root);
    expect(checkpoint.entities.c1).toBe("metadata_fetched");

    const raw = await readFile(join(root, "data/checkpoint.json"), "utf8");
    expect(JSON.parse(raw).entities.c1).toBe("metadata_fetched");
  });

  it("rejects illegal state transitions", async () => {
    await applyEvent(root, { type: "candidate_discovered", entity_id: "c1", at: "2026-06-14T00:00:00Z", payload: {} });

    await expect(
      applyEvent(root, { type: "candidate_assets_cached", entity_id: "c1", at: "2026-06-14T00:00:01Z", payload: {} })
    ).rejects.toThrow("Illegal transition");
  });

  it("rebuilds checkpoint from events when checkpoint is corrupt", async () => {
    await applyEvent(root, { type: "candidate_discovered", entity_id: "c1", at: "2026-06-14T00:00:00Z", payload: {} });
    await writeFile(join(root, "data/checkpoint.json"), "{not-json", "utf8");

    const checkpoint = await readCheckpointOrRebuild(root);
    expect(checkpoint.entities.c1).toBe("discovered");
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/core/events.test.ts
```

Expected: FAIL because event modules do not exist.

- [ ] **Step 3: Implement atomic file helpers**

```ts
// /Users/tristanzh/agent/Git-Scout/src/core/atomicFiles.ts
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function fsyncPath(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsyncPath(tmp);
  await rename(tmp, path);
  await fsyncPath(dirname(path));
}

export async function appendJsonlAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "a" });
}

export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement event reducer**

```ts
// /Users/tristanzh/agent/Git-Scout/src/core/events.ts
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SentinelEvent, SentinelEventSchema, CandidateState } from "../schemas/sentinel";
import { appendJsonlAtomic, readJsonOrNull, writeJsonAtomic } from "./atomicFiles";

export type Checkpoint = {
  version: 1;
  entities: Record<string, CandidateState>;
  updated_at: string;
};

const EVENT_TO_STATE: Record<string, CandidateState> = {
  candidate_discovered: "discovered",
  candidate_metadata_fetched: "metadata_fetched",
  candidate_cheap_classified: "cheap_classified",
  candidate_assets_cached: "assets_cached",
  candidate_awaiting_tz_gate: "awaiting_tz_gate",
  candidate_rejected: "rejected_terminal",
  candidate_approved: "approved_for_audit",
  audit_pack_prepared: "audit_pack_prepared",
  audit_budget_reserved: "audit_budget_reserved",
  audit_running: "audit_running",
  audit_complete: "audit_complete",
  failed_retryable: "failed_retryable",
  failed_terminal: "failed_terminal"
};

const LEGAL_NEXT: Record<CandidateState | "none", CandidateState[]> = {
  none: ["discovered"],
  discovered: ["metadata_fetched", "failed_retryable", "failed_terminal"],
  metadata_fetched: ["cheap_classified", "failed_retryable", "failed_terminal"],
  cheap_classified: ["assets_cached", "failed_retryable", "failed_terminal"],
  assets_cached: ["awaiting_tz_gate", "failed_retryable", "failed_terminal"],
  awaiting_tz_gate: ["rejected_terminal", "approved_for_audit"],
  rejected_terminal: [],
  approved_for_audit: ["audit_pack_prepared", "failed_retryable", "failed_terminal"],
  audit_pack_prepared: ["audit_budget_reserved", "failed_retryable", "failed_terminal"],
  audit_budget_reserved: ["audit_running", "failed_retryable", "failed_terminal"],
  audit_running: ["audit_complete", "failed_retryable", "failed_terminal"],
  audit_complete: [],
  failed_retryable: ["metadata_fetched", "cheap_classified", "assets_cached", "audit_pack_prepared", "audit_budget_reserved"],
  failed_terminal: []
};

function paths(root: string) {
  return {
    dataDir: join(root, "data"),
    events: join(root, "data/events.jsonl"),
    checkpoint: join(root, "data/checkpoint.json")
  };
}

function reduceEvent(checkpoint: Checkpoint, event: SentinelEvent): Checkpoint {
  const target = EVENT_TO_STATE[event.type];
  if (!target || !event.entity_id) return { ...checkpoint, updated_at: event.at };

  const current = checkpoint.entities[event.entity_id] ?? "none";
  if (!LEGAL_NEXT[current].includes(target)) {
    throw new Error(`Illegal transition from ${current} to ${target}`);
  }

  return {
    version: 1,
    entities: { ...checkpoint.entities, [event.entity_id]: target },
    updated_at: event.at
  };
}

export async function readCheckpointOrRebuild(root: string): Promise<Checkpoint> {
  const p = paths(root);
  const existing = await readJsonOrNull<Checkpoint>(p.checkpoint);
  if (existing?.version === 1 && existing.entities) return existing;

  let checkpoint: Checkpoint = { version: 1, entities: {}, updated_at: "" };
  try {
    const lines = (await readFile(p.events, "utf8")).split("\n").filter(Boolean);
    for (const line of lines) {
      checkpoint = reduceEvent(checkpoint, SentinelEventSchema.parse(JSON.parse(line)));
    }
  } catch {
    checkpoint = { version: 1, entities: {}, updated_at: "" };
  }
  await writeJsonAtomic(p.checkpoint, checkpoint);
  return checkpoint;
}

export async function applyEvent(root: string, event: SentinelEvent) {
  const p = paths(root);
  await mkdir(p.dataDir, { recursive: true });
  const parsed = SentinelEventSchema.parse(event);
  const current = await readCheckpointOrRebuild(root);
  const next = reduceEvent(current, parsed);
  await appendJsonlAtomic(p.events, parsed);
  await writeJsonAtomic(p.checkpoint, next);
}
```

- [ ] **Step 5: Verify event tests**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/core/events.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit event state**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add src/core/atomicFiles.ts src/core/events.ts tests/core/events.test.ts
git commit -m "feat(sentinel): add event checkpoint state"
```

## Task 4: Implement Token Budget Ledger and Audit Guardrails

**Files:**
- Create: `/Users/tristanzh/agent/Git-Scout/src/core/budgetLedger.ts`
- Create: `/Users/tristanzh/agent/Git-Scout/src/audit/auditRunner.ts`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/audit/auditRunner.test.ts`

- [ ] **Step 1: Write failing audit guardrail tests**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/audit/auditRunner.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStrongAudit } from "../../src/audit/auditRunner";
import { initializeBudget } from "../../src/core/budgetLedger";

let root: string;

const job = {
  job_id: "audit:owner/repo:2026-06-14",
  candidate_id: "github:owner/repo:2026-06-14",
  input_pack: {
    readme_digest_path: "data/audits/owner-repo/readme.digest.md",
    file_tree_path: "data/audits/owner-repo/file-tree.json",
    selected_snippets_path: "data/audits/owner-repo/snippets.json",
    artifact_index_path: "data/audits/owner-repo/artifacts.json"
  },
  budget: { max_input_tokens: 100, max_output_tokens: 40, daily_budget_key: "2026-06-14" },
  state: "queued" as const
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-audit-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("strong audit guardrails", () => {
  it("does not call strong model when daily budget is exhausted", async () => {
    await initializeBudget(root, "2026-06-14", 20);
    const model = vi.fn();

    const result = await runStrongAudit(root, job, { input_tokens: 60, contains_raw_readme: false, contains_unbounded_source: false }, model);

    expect(result.status).toBe("skipped_budget_exhausted");
    expect(model).not.toHaveBeenCalled();
  });

  it("fails terminally when audit pack contains raw readme", async () => {
    await initializeBudget(root, "2026-06-14", 1000);
    const model = vi.fn();

    const result = await runStrongAudit(root, job, { input_tokens: 60, contains_raw_readme: true, contains_unbounded_source: false }, model);

    expect(result.status).toBe("failed_terminal");
    expect(result.reason).toBe("RAW_OR_UNBOUNDED_INPUT_FORBIDDEN");
    expect(model).not.toHaveBeenCalled();
  });

  it("reconciles unused reserved budget after successful audit", async () => {
    await initializeBudget(root, "2026-06-14", 200);
    const model = vi.fn(async () => ({ actual_tokens: 70, report: { verdict: "watch" } }));

    const result = await runStrongAudit(root, job, { input_tokens: 60, contains_raw_readme: false, contains_unbounded_source: false }, model);

    expect(result.status).toBe("audit_complete");
    expect(result.remaining).toBe(130);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/audit/auditRunner.test.ts
```

Expected: FAIL because budget and audit modules do not exist.

- [ ] **Step 3: Implement budget ledger**

```ts
// /Users/tristanzh/agent/Git-Scout/src/core/budgetLedger.ts
import { join } from "node:path";
import { readJsonOrNull, writeJsonAtomic } from "./atomicFiles";

type Ledger = {
  version: 1;
  days: Record<string, { limit: number; remaining: number; reservations: Record<string, number> }>;
};

function ledgerPath(root: string) {
  return join(root, "data/budget-ledger.json");
}

async function readLedger(root: string): Promise<Ledger> {
  return (await readJsonOrNull<Ledger>(ledgerPath(root))) ?? { version: 1, days: {} };
}

export async function initializeBudget(root: string, day: string, limit: number) {
  const ledger = await readLedger(root);
  ledger.days[day] = { limit, remaining: limit, reservations: {} };
  await writeJsonAtomic(ledgerPath(root), ledger);
}

export async function reserveBudget(root: string, day: string, jobId: string, tokens: number) {
  const ledger = await readLedger(root);
  const entry = ledger.days[day];
  if (!entry || entry.remaining < tokens) return { ok: false as const, remaining: entry?.remaining ?? 0 };
  entry.remaining -= tokens;
  entry.reservations[jobId] = (entry.reservations[jobId] ?? 0) + tokens;
  await writeJsonAtomic(ledgerPath(root), ledger);
  return { ok: true as const, reserved: tokens, remaining: entry.remaining };
}

export async function reconcileBudget(root: string, day: string, jobId: string, actualTokens: number) {
  const ledger = await readLedger(root);
  const entry = ledger.days[day];
  if (!entry) throw new Error(`Budget day not initialized: ${day}`);
  const reserved = entry.reservations[jobId] ?? 0;
  const refund = Math.max(0, reserved - actualTokens);
  entry.remaining += refund;
  delete entry.reservations[jobId];
  await writeJsonAtomic(ledgerPath(root), ledger);
  return { remaining: entry.remaining };
}
```

- [ ] **Step 4: Implement strong audit runner**

```ts
// /Users/tristanzh/agent/Git-Scout/src/audit/auditRunner.ts
import { AuditJob, AuditJobSchema } from "../schemas/sentinel";
import { reconcileBudget, reserveBudget } from "../core/budgetLedger";

export type AuditPackStats = {
  input_tokens: number;
  contains_raw_readme: boolean;
  contains_unbounded_source: boolean;
};

export type StrongModelClient = () => Promise<{ actual_tokens: number; report: unknown }>;

export async function runStrongAudit(root: string, jobInput: AuditJob, pack: AuditPackStats, model: StrongModelClient) {
  const job = AuditJobSchema.parse(jobInput);

  if (pack.contains_raw_readme || pack.contains_unbounded_source) {
    return { status: "failed_terminal" as const, reason: "RAW_OR_UNBOUNDED_INPUT_FORBIDDEN" };
  }

  if (pack.input_tokens > job.budget.max_input_tokens) {
    return { status: "failed_terminal" as const, reason: "JOB_INPUT_TOKEN_LIMIT_EXCEEDED" };
  }

  const required = pack.input_tokens + job.budget.max_output_tokens;
  const reservation = await reserveBudget(root, job.budget.daily_budget_key, job.job_id, required);

  if (!reservation.ok) {
    return { status: "skipped_budget_exhausted" as const, required, remaining: reservation.remaining };
  }

  const result = await model();
  const reconciled = await reconcileBudget(root, job.budget.daily_budget_key, job.job_id, result.actual_tokens);

  return { status: "audit_complete" as const, report: result.report, remaining: reconciled.remaining };
}
```

- [ ] **Step 5: Verify audit guardrails**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/audit/auditRunner.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit audit guardrails**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add src/core/budgetLedger.ts src/audit/auditRunner.ts tests/audit/auditRunner.test.ts
git commit -m "feat(sentinel): add token budget guardrails"
```

## Task 5: Build Blacklist-Aware Daily Queue From Fixtures

**Files:**
- Create: `/Users/tristanzh/agent/Git-Scout/fixtures/raw-candidates.json`
- Create: `/Users/tristanzh/agent/Git-Scout/src/scout/dailyQueue.ts`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/scout/dailyQueue.test.ts`

- [ ] **Step 1: Write failing daily queue tests**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/scout/dailyQueue.test.ts
import { describe, expect, it } from "vitest";
import { buildDailyQueue } from "../../src/scout/dailyQueue";

describe("daily candidate queue", () => {
  it("returns exactly five valid candidates sorted by scout quality", () => {
    const result = buildDailyQueue("2026-06-14", [
      { owner: "a", name: "one", stars: 10, category: "ppt_generation", score: 0.99, has_artifact: true },
      { owner: "b", name: "two", stars: 20, category: "svg_synthesis", score: 0.80, has_artifact: true },
      { owner: "c", name: "three", stars: 30, category: "magazine_composition", score: 0.70, has_artifact: true },
      { owner: "d", name: "four", stars: 40, category: "multimodal_layout", score: 0.60, has_artifact: true },
      { owner: "e", name: "five", stars: 50, category: "advanced_document_layout", score: 0.50, has_artifact: true },
      { owner: "f", name: "six", stars: 60, category: "ppt_generation", score: 0.40, has_artifact: true }
    ], { owners: [], repos: [] });

    expect(result).toHaveLength(5);
    expect(result[0].repo.owner).toBe("a");
    expect(result[4].repo.owner).toBe("e");
  });

  it("filters rejected owners and repos before selecting five", () => {
    const result = buildDailyQueue("2026-06-14", [
      { owner: "bad", name: "one", stars: 10, category: "ppt_generation", score: 0.99, has_artifact: true },
      { owner: "ok", name: "blocked", stars: 10, category: "ppt_generation", score: 0.98, has_artifact: true },
      { owner: "a", name: "one", stars: 10, category: "ppt_generation", score: 0.90, has_artifact: true },
      { owner: "b", name: "two", stars: 20, category: "svg_synthesis", score: 0.80, has_artifact: true },
      { owner: "c", name: "three", stars: 30, category: "magazine_composition", score: 0.70, has_artifact: true },
      { owner: "d", name: "four", stars: 40, category: "multimodal_layout", score: 0.60, has_artifact: true },
      { owner: "e", name: "five", stars: 50, category: "advanced_document_layout", score: 0.50, has_artifact: true }
    ], { owners: ["bad"], repos: ["ok/blocked"] });

    expect(result.map((item) => `${item.repo.owner}/${item.repo.name}`)).toEqual(["a/one", "b/two", "c/three", "d/four", "e/five"]);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/scout/dailyQueue.test.ts
```

Expected: FAIL because `dailyQueue.ts` does not exist.

- [ ] **Step 3: Implement fixture queue builder**

```ts
// /Users/tristanzh/agent/Git-Scout/src/scout/dailyQueue.ts
import { Candidate } from "../schemas/sentinel";

type RawCandidate = {
  owner: string;
  name: string;
  stars: number;
  category: Candidate["scout"]["category"];
  score: number;
  has_artifact: boolean;
};

type Blacklist = {
  owners: string[];
  repos: string[];
};

export function buildDailyQueue(day: string, raw: RawCandidate[], blacklist: Blacklist): Candidate[] {
  return raw
    .filter((item) => item.has_artifact)
    .filter((item) => !blacklist.owners.includes(item.owner))
    .filter((item) => !blacklist.repos.includes(`${item.owner}/${item.name}`))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({
      id: `github:${item.owner}/${item.name}:${day}`,
      source: { kind: "github", url: `https://github.com/${item.owner}/${item.name}`, fetched_at: `${day}T08:00:00+08:00` },
      repo: { owner: item.owner, name: item.name, stars: item.stars, language: null, license: null },
      scout: {
        category: item.category,
        keep_reason: "Fixture-selected quality tool candidate.",
        reject_risk: "Requires later source-level audit.",
        estimated_token_roi: item.score,
        aesthetic_prior: item.score,
        confidence: item.score
      },
      artifacts: [{
        kind: "image",
        source_url: `https://example.com/${item.owner}-${item.name}.png`,
        local_path: `data/artifacts/${item.owner}-${item.name}/sample.png`,
        sha256: `${item.owner}-${item.name}-fixture`
      }],
      state: "awaiting_tz_gate"
    }));
}
```

- [ ] **Step 4: Add deterministic fixture input**

```json
// /Users/tristanzh/agent/Git-Scout/fixtures/raw-candidates.json
[
  { "owner": "layout-labs", "name": "decksmith", "stars": 4200, "category": "ppt_generation", "score": 0.94, "has_artifact": true },
  { "owner": "svg-foundry", "name": "vector-weaver", "stars": 3100, "category": "svg_synthesis", "score": 0.88, "has_artifact": true },
  { "owner": "paper-ui", "name": "magazine-grid", "stars": 2800, "category": "magazine_composition", "score": 0.84, "has_artifact": true },
  { "owner": "doc-kernel", "name": "flow-layout", "stars": 2600, "category": "advanced_document_layout", "score": 0.80, "has_artifact": true },
  { "owner": "multi-modal", "name": "artifact-stage", "stars": 2400, "category": "multimodal_layout", "score": 0.76, "has_artifact": true },
  { "owner": "wrapper-shop", "name": "ai-slide-prompt", "stars": 9000, "category": "ppt_generation", "score": 0.20, "has_artifact": false }
]
```

- [ ] **Step 5: Verify queue tests**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/scout/dailyQueue.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit queue builder**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add fixtures/raw-candidates.json src/scout/dailyQueue.ts tests/scout/dailyQueue.test.ts
git commit -m "feat(sentinel): build fixture daily queue"
```

## Task 6: Add Local Dashboard Decision Endpoints

**Files:**
- Create: `/Users/tristanzh/agent/Git-Scout/src/dashboard/server.ts`
- Create: `/Users/tristanzh/agent/Git-Scout/public/index.html`
- Create: `/Users/tristanzh/agent/Git-Scout/public/app.js`
- Create: `/Users/tristanzh/agent/Git-Scout/public/styles.css`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/dashboard/server.test.ts`

- [ ] **Step 1: Write failing dashboard endpoint test**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/dashboard/server.test.ts
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/dashboard/server";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-dashboard-"));
  await mkdir(join(root, "data/candidates"), { recursive: true });
  await writeFile(join(root, "data/candidates/2026-06-14.json"), "[]\n", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("dashboard server", () => {
  it("writes schema-valid approve decisions", async () => {
    const server = createDashboardServer(root);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/api/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidate_id: "github:owner/repo:2026-06-14",
        decision: "approve",
        decided_by: "TZ",
        decided_at: "2026-06-14T08:10:00+08:00",
        notes: "Looks restrained.",
        blacklist: null
      })
    });

    expect(response.status).toBe(200);
    const saved = JSON.parse(await readFile(join(root, "data/decisions/2026-06-14.json"), "utf8"));
    expect(saved[0].decision).toBe("approve");
    server.close();
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/dashboard/server.test.ts
```

Expected: FAIL because dashboard server does not exist.

- [ ] **Step 3: Implement dashboard server**

```ts
// /Users/tristanzh/agent/Git-Scout/src/dashboard/server.ts
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GateDecision, GateDecisionSchema } from "../schemas/sentinel";
import { readJsonOrNull, writeJsonAtomic } from "../core/atomicFiles";

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function decisionDay(decision: GateDecision) {
  return decision.candidate_id.split(":").at(-1) ?? "unknown";
}

export function createDashboardServer(root: string) {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(await readFile(join(root, "public/index.html"), "utf8").catch(() => "<main>Project Sentinel v3</main>"));
        return;
      }

      if (req.method === "GET" && req.url === "/styles.css") {
        res.setHeader("content-type", "text/css; charset=utf-8");
        res.end(await readFile(join(root, "public/styles.css"), "utf8"));
        return;
      }

      if (req.method === "GET" && req.url === "/app.js") {
        res.setHeader("content-type", "application/javascript; charset=utf-8");
        res.end(await readFile(join(root, "public/app.js"), "utf8"));
        return;
      }

      if (req.method === "POST" && req.url === "/api/decision") {
        const decision = GateDecisionSchema.parse(JSON.parse(await readBody(req)));
        const day = decisionDay(decision);
        const path = join(root, `data/decisions/${day}.json`);
        await mkdir(join(root, "data/decisions"), { recursive: true });
        const existing = (await readJsonOrNull<GateDecision[]>(path)) ?? [];
        await writeJsonAtomic(path, [...existing, decision]);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    } catch (error) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown error" }));
    }
  });
}
```

- [ ] **Step 4: Add minimal dark dashboard assets**

```html
<!-- /Users/tristanzh/agent/Git-Scout/public/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Project Sentinel v3</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="leads" aria-label="Candidate leads"></section>
      <section class="theater" aria-label="Artifacts theater"></section>
      <section class="verdict" aria-label="Decision panel">
        <h1>Project Sentinel</h1>
        <button id="approve" type="button">Approve</button>
        <button id="reject" type="button">Reject</button>
      </section>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
```

```css
/* /Users/tristanzh/agent/Git-Scout/public/styles.css */
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #090a0f;
  color: #f5f7fb;
}

body {
  margin: 0;
  min-height: 100vh;
}

.shell {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(360px, 1.6fr) minmax(260px, 0.9fr);
  gap: 1px;
  min-height: 100vh;
  background: #242733;
}

.leads,
.theater,
.verdict {
  background: #090a0f;
  padding: 24px;
}

button {
  width: 100%;
  min-height: 44px;
  margin-top: 12px;
  border: 1px solid #303646;
  background: #111522;
  color: #f5f7fb;
}
```

```js
// /Users/tristanzh/agent/Git-Scout/public/app.js
const candidateId = "github:fixture/review:2026-06-14";

async function decide(decision) {
  await fetch("/api/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      candidate_id: candidateId,
      decision,
      decided_by: "TZ",
      decided_at: new Date().toISOString(),
      notes: decision === "approve" ? "Approved from local dashboard." : "Rejected from local dashboard.",
      blacklist: decision === "reject" ? { repo: "fixture/review", owner: "fixture", reason: "Rejected by TZ gate." } : null
    })
  });
}

document.getElementById("approve").addEventListener("click", () => decide("approve"));
document.getElementById("reject").addEventListener("click", () => decide("reject"));
```

- [ ] **Step 5: Verify dashboard endpoint**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/dashboard/server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit dashboard endpoints**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add src/dashboard/server.ts public/index.html public/app.js public/styles.css tests/dashboard/server.test.ts
git commit -m "feat(sentinel): add local dashboard decisions"
```

## Task 7: Wire CLI Commands and End-to-End Verification

**Files:**
- Modify: `/Users/tristanzh/agent/Git-Scout/src/cli.ts`
- Test: `/Users/tristanzh/agent/Git-Scout/tests/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

```ts
// /Users/tristanzh/agent/Git-Scout/tests/cli.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedFixtureQueue } from "../src/cli";

let root: string;

const raw = [
  { owner: "layout-labs", name: "decksmith", stars: 4200, category: "ppt_generation", score: 0.94, has_artifact: true },
  { owner: "svg-foundry", name: "vector-weaver", stars: 3100, category: "svg_synthesis", score: 0.88, has_artifact: true },
  { owner: "paper-ui", name: "magazine-grid", stars: 2800, category: "magazine_composition", score: 0.84, has_artifact: true },
  { owner: "doc-kernel", name: "flow-layout", stars: 2600, category: "advanced_document_layout", score: 0.80, has_artifact: true },
  { owner: "multi-modal", name: "artifact-stage", stars: 2400, category: "multimodal_layout", score: 0.76, has_artifact: true }
] as const;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-cli-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("CLI helpers", () => {
  it("seeds exactly five candidates", async () => {
    await seedFixtureQueue(root, "2026-06-14", [...raw]);
    const saved = JSON.parse(await readFile(join(root, "data/candidates/2026-06-14.json"), "utf8"));
    expect(saved).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test -- tests/cli.test.ts
```

Expected: FAIL because `seedFixtureQueue` is not exported.

- [ ] **Step 3: Implement CLI helpers and commands**

```ts
// /Users/tristanzh/agent/Git-Scout/src/cli.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./core/atomicFiles";
import { buildDailyQueue } from "./scout/dailyQueue";
import { createDashboardServer } from "./dashboard/server";

export const appName = "Project Sentinel v3";

export async function seedFixtureQueue(root = process.cwd(), day = new Date().toISOString().slice(0, 10), rawCandidates?: Parameters<typeof buildDailyQueue>[1]) {
  const raw = rawCandidates ?? JSON.parse(await readFile(join(root, "fixtures/raw-candidates.json"), "utf8"));
  const queue = buildDailyQueue(day, raw, { owners: [], repos: [] });
  await writeJsonAtomic(join(root, `data/candidates/${day}.json`), queue);
  return queue;
}

async function main() {
  const command = process.argv[2] ?? "help";

  if (command === "seed") {
    const queue = await seedFixtureQueue(process.cwd());
    console.log(`seeded ${queue.length} candidates`);
    return;
  }

  if (command === "serve") {
    const port = Number(process.env.PORT ?? 4173);
    createDashboardServer(process.cwd()).listen(port, "127.0.0.1", () => {
      console.log(`Project Sentinel v3 dashboard: http://127.0.0.1:${port}`);
    });
    return;
  }

  if (command === "audit-dry-run") {
    console.log("audit dry-run available after Task 4 guardrails");
    return;
  }

  console.log(appName);
  console.log("commands: seed, serve, audit-dry-run");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Verify CLI tests and commands**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test
npm run typecheck
npm run seed
```

Expected:

```text
seeded 5 candidates
```

- [ ] **Step 5: Start local dashboard for manual verification**

Run:

```bash
cd /Users/tristanzh/agent/Git-Scout
PORT=4173 npm run serve
```

Expected:

```text
Project Sentinel v3 dashboard: http://127.0.0.1:4173
```

Open `http://127.0.0.1:4173` and verify the dark three-column shell renders. Stop the server after verification.

- [ ] **Step 6: Commit CLI wiring**

```bash
cd /Users/tristanzh/agent/Git-Scout
git add src/cli.ts tests/cli.test.ts data/candidates/2026-06-14.json
git commit -m "feat(sentinel): wire local mvp cli"
```

## Final Verification

- [ ] Run full tests:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm test
```

Expected: all test files pass.

- [ ] Run typecheck:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm run typecheck
```

Expected: no TypeScript errors.

- [ ] Run seed command:

```bash
cd /Users/tristanzh/agent/Git-Scout
npm run seed
```

Expected: `data/candidates/<today>.json` contains exactly five candidates.

- [ ] Run dashboard smoke:

```bash
cd /Users/tristanzh/agent/Git-Scout
PORT=4173 npm run serve
```

Expected: dashboard URL prints and local page renders.

## Self-Review Notes

- SDD coverage: this plan covers JSON contracts, local state, checkpoint rebuild, token circuit breaker, blacklist queue filtering, and local dashboard approve/reject decisions.
- Deferred SDD items: live GitHub/RSS ingestion, real model provider routing, launchd scheduling, artifact screenshot harvesting, and hard-core source audit prompt packs require separate plans after this MVP is verified.
- Boundary check: this plan does not touch `/Users/tristanzh/agent/web`, does not print or store API keys, and does not call paid model APIs.
