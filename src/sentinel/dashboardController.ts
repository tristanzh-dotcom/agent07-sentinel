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

export function createDashboardFileStorage(_path: string): DashboardStorage {
  throw new DashboardControllerNotImplementedError("createDashboardFileStorage");
}

export async function rejectLead(_input: RejectLeadInput): Promise<DashboardState> {
  throw new DashboardControllerNotImplementedError("rejectLead");
}

export async function approveLeadForAudit(_input: ApproveLeadInput): Promise<DashboardState> {
  throw new DashboardControllerNotImplementedError("approveLeadForAudit");
}

export function shouldBlockCandidateBeforeTokenSpend(
  _state: DashboardState,
  _candidate: DashboardCandidateIdentity
): boolean {
  throw new DashboardControllerNotImplementedError("shouldBlockCandidateBeforeTokenSpend");
}
