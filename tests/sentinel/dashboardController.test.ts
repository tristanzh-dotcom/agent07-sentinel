import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveLeadForAudit,
  createDashboardFileStorage,
  DashboardLead,
  DashboardState,
  DashboardStorage,
  rejectLead,
  shouldBlockCandidateBeforeTokenSpend
} from "../../src/sentinel/dashboardController.js";

let root: string;
let dashboardPath: string;

function makeLead(index: number, overrides: Partial<DashboardLead> = {}): DashboardLead {
  return {
    id: `lead-${index}`,
    repo: `github/designer-ai/tool-${index}`,
    author: "designer-ai",
    title: `Tool ${index}`,
    status: "PENDING",
    audit_status: "IDLE",
    locked: false,
    token_roi_estimate: 0.75,
    ...overrides
  };
}

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    version: 1,
    run_id: "run-dashboard-red",
    updated_at: "2026-06-15T09:00:00+08:00",
    leads: [
      makeLead(1, {
        repo: "github/cheap-templates/bad-ppt",
        author: "cheap-templates",
        title: "Bad PPT"
      }),
      makeLead(2, {
        repo: "github/designer-ai/vector-ppt-engine",
        author: "designer-ai",
        title: "Vector PPT Engine"
      })
    ],
    blacklist: {
      repos: [],
      authors: []
    },
    ...overrides
  };
}

function createMemoryStorage(initial: DashboardState): DashboardStorage & { current: () => DashboardState } {
  let state = structuredClone(initial);
  return {
    read: vi.fn(async () => structuredClone(state)),
    mutate: vi.fn(async (mutator: (current: DashboardState) => DashboardState) => {
      state = mutator(structuredClone(state));
      return structuredClone(state);
    }),
    current: () => structuredClone(state)
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-dashboard-"));
  dashboardPath = join(root, "scout_pipeline.json");
  await writeFile(dashboardPath, `${JSON.stringify(makeState(), null, 2)}\n`, "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readDashboardJson(): Promise<DashboardState> {
  return JSON.parse(await readFile(dashboardPath, "utf8")) as DashboardState;
}

async function listDashboardTempFiles() {
  return (await readdir(root)).filter((name) => name.includes(".json.tmp") || name.endsWith(".tmp"));
}

describe("Milestone 3 dashboard controller TDD contract", () => {
  it("rejects a lead by atomically removing it from the stream and blacklisting it before future token spend", async () => {
    const storage = createMemoryStorage(makeState());
    const tokenSpendingClassifier = vi.fn(async (_candidate: { repo: string; author: string }) => ({ relevant: true }));

    const next = await rejectLead({
      storage,
      repo: "github/cheap-templates/bad-ppt",
      banAuthor: true
    });

    expect(storage.mutate).toHaveBeenCalledTimes(1);
    expect(next.leads.map((lead) => lead.repo)).not.toContain("github/cheap-templates/bad-ppt");
    expect(next.blacklist.repos).toContain("github/cheap-templates/bad-ppt");
    expect(next.blacklist.authors).toContain("cheap-templates");

    const candidate = {
      repo: "github/cheap-templates/bad-ppt",
      author: "cheap-templates"
    };
    if (!shouldBlockCandidateBeforeTokenSpend(next, candidate)) {
      await tokenSpendingClassifier(candidate);
    }

    expect(tokenSpendingClassifier).not.toHaveBeenCalled();
  });

  it("approves a lead by locking it, switching audit state to AUDITING, and waking the hard-core auditor", async () => {
    const storage = createMemoryStorage(makeState());
    const auditor = {
      wake: vi.fn(async () => undefined)
    };

    const next = await approveLeadForAudit({
      storage,
      auditor,
      repo: "github/designer-ai/vector-ppt-engine"
    });

    const approved = next.leads.find((lead) => lead.repo === "github/designer-ai/vector-ppt-engine");
    expect(storage.mutate).toHaveBeenCalledTimes(1);
    expect(approved).toMatchObject({
      status: "APPROVED",
      audit_status: "AUDITING",
      locked: true
    });
    expect(auditor.wake).toHaveBeenCalledTimes(1);
    expect(auditor.wake).toHaveBeenCalledWith(expect.objectContaining({ repo: "github/designer-ai/vector-ppt-engine" }));
  });

  it("serializes dashboard approval with a concurrent scout snapshot write without corrupting or losing state", async () => {
    const storage = createDashboardFileStorage(dashboardPath);
    const auditor = {
      wake: vi.fn(async () => undefined)
    };
    const scoutLeads = Array.from({ length: 5 }, (_, index) =>
      makeLead(100 + index, {
        repo: `github/new-scout/layout-tool-${index}`,
        author: "new-scout",
        title: `Layout Tool ${index}`
      })
    );

    const scoutSnapshotWrite = storage.mutate((current) => ({
      ...current,
      leads: [...current.leads, ...scoutLeads],
      updated_at: "2026-06-15T09:01:00+08:00"
    }));
    const dashboardApprove = approveLeadForAudit({
      storage,
      auditor,
      repo: "github/designer-ai/vector-ppt-engine"
    });

    await Promise.all([scoutSnapshotWrite, dashboardApprove]);

    const finalState = await readDashboardJson();
    const approved = finalState.leads.find((lead) => lead.repo === "github/designer-ai/vector-ppt-engine");

    expect(finalState.version).toBe(1);
    expect(finalState.leads.filter((lead) => lead.repo.startsWith("github/new-scout/"))).toHaveLength(5);
    expect(approved).toMatchObject({
      status: "APPROVED",
      audit_status: "AUDITING",
      locked: true
    });
    expect(await listDashboardTempFiles()).toEqual([]);
    expect(auditor.wake).toHaveBeenCalledTimes(1);
  });
});
