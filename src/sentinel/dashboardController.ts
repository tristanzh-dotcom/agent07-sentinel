import { constants } from "node:fs";
import { mkdir, open, readFile, rm, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

export class DashboardControllerNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "DashboardControllerNotImplementedError";
  }
}

export type DashboardLeadStatus = "PENDING" | "APPROVED" | "REJECTED";
export type DashboardAuditStatus = "IDLE" | "AUDITING" | "COMPLETED" | "FAILED";

export type DashboardLead = {
  id: string;
  repo: string;
  author: string;
  title: string;
  status: DashboardLeadStatus;
  audit_status: DashboardAuditStatus;
  locked: boolean;
  token_roi_estimate: number;
};

export type DashboardBlacklist = {
  repos: string[];
  authors: string[];
};

export type DashboardState = {
  version: 1;
  run_id: string;
  updated_at: string;
  leads: DashboardLead[];
  blacklist: DashboardBlacklist;
};

export type DashboardCandidateIdentity = {
  repo: string;
  author?: string;
};

export type DashboardStorage = {
  read: () => Promise<DashboardState>;
  mutate: (mutator: (current: DashboardState) => DashboardState) => Promise<DashboardState>;
};

export type HardCoreAuditor = {
  wake: (lead: DashboardLead) => Promise<void>;
};

export type RejectLeadInput = {
  storage: DashboardStorage;
  repo: string;
  banAuthor?: boolean;
};

export type ApproveLeadInput = {
  storage: DashboardStorage;
  auditor: HardCoreAuditor;
  repo: string;
};

const lockPollMs = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniquePush(values: string[], value: string | undefined) {
  if (!value) return values;
  return Array.from(new Set([...values, value]));
}

function lockPathFor(path: string) {
  return join(dirname(path), `${basename(path)}.lock`);
}

function tempPathFor(path: string) {
  return join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.json.tmp`);
}

async function acquireLock(path: string) {
  const lockPath = lockPathFor(path);

  for (;;) {
    try {
      await mkdir(lockPath);
      return lockPath;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      await sleep(lockPollMs);
    }
  }
}

async function withFileLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lockPath = await acquireLock(path);
  try {
    return await work();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function fsyncFile(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function assertDashboardState(value: unknown): asserts value is DashboardState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid dashboard state: expected object");
  }

  const state = value as Partial<DashboardState>;
  if (
    state.version !== 1 ||
    typeof state.run_id !== "string" ||
    typeof state.updated_at !== "string" ||
    !Array.isArray(state.leads) ||
    !state.blacklist ||
    !Array.isArray(state.blacklist.repos) ||
    !Array.isArray(state.blacklist.authors)
  ) {
    throw new Error("Invalid dashboard state contract");
  }
}

async function readDashboardState(path: string): Promise<DashboardState> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertDashboardState(parsed);
  return parsed;
}

async function writeDashboardStateAtomic(path: string, state: DashboardState): Promise<void> {
  assertDashboardState(state);
  const tmpPath = tempPathFor(path);

  try {
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fsyncFile(tmpPath);
    await rename(tmpPath, path);
    await fsyncDirectory(dirname(path));
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

export function createDashboardFileStorage(path: string): DashboardStorage {
  return {
    read: () => readDashboardState(path),
    mutate: (mutator) =>
      withFileLock(path, async () => {
        const current = await readDashboardState(path);
        const next = mutator(current);
        await writeDashboardStateAtomic(path, next);
        return next;
      })
  };
}

export async function rejectLead(input: RejectLeadInput): Promise<DashboardState> {
  return input.storage.mutate((current) => {
    const rejected = current.leads.find((lead) => lead.repo === input.repo);
    if (!rejected) {
      throw new Error(`Dashboard lead not found: ${input.repo}`);
    }

    return {
      ...current,
      leads: current.leads.filter((lead) => lead.repo !== input.repo),
      blacklist: {
        repos: uniquePush(current.blacklist.repos, rejected.repo),
        authors: input.banAuthor ? uniquePush(current.blacklist.authors, rejected.author) : current.blacklist.authors
      }
    };
  });
}

export async function approveLeadForAudit(input: ApproveLeadInput): Promise<DashboardState> {
  let approvedLead: DashboardLead | null = null;

  const next = await input.storage.mutate((current) => {
    const leads = current.leads.map((lead) => {
      if (lead.repo !== input.repo) return lead;

      approvedLead = {
        ...lead,
        status: "APPROVED",
        audit_status: "AUDITING",
        locked: true
      };
      return approvedLead;
    });

    if (!approvedLead) {
      throw new Error(`Dashboard lead not found: ${input.repo}`);
    }

    return {
      ...current,
      leads
    };
  });

  if (approvedLead) {
    try {
      void input.auditor.wake(approvedLead).catch(() => undefined);
    } catch {
      // The dashboard transition is already persisted; auditor failures are handled by the audit worker.
    }
  }

  return next;
}

export function shouldBlockCandidateBeforeTokenSpend(
  state: DashboardState,
  candidate: DashboardCandidateIdentity
): boolean {
  return state.blacklist.repos.includes(candidate.repo) || Boolean(candidate.author && state.blacklist.authors.includes(candidate.author));
}
