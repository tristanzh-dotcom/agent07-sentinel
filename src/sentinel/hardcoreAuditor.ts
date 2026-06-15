export class HardCoreAuditorNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "HardCoreAuditorNotImplementedError";
  }
}

export type AuditVerdict = "REAL_LAYOUT_ENGINE" | "PROMPT_POSITIONING" | "UNCLEAR";

export type AuditLead = {
  id: string;
  repo: string;
  title: string;
  status: "APPROVED";
  audit_status: "AUDITING";
  locked: true;
};

export type RepositorySandboxClient = {
  checkout: (input: { repo: string; destination: string }) => Promise<{
    sourceFiles: Array<{ path: string; content: string }>;
    readme?: string;
  }>;
};

export type StrongReasoningAuditClient = {
  audit: (input: {
    systemPrompt: string;
    repo: string;
    sourceDigest: string;
  }) => Promise<string>;
};

export type AuditReport = {
  repo: string;
  verdict: AuditVerdict;
  evidence: string[];
  confidence: number;
  integration: {
    estimated_glue_code_lines: number;
    supports_zero_dependency_export: boolean;
    friction_score: number;
  };
  boundary_risks: string[];
  markdown_path: string;
};

export type RunHardcoreAuditInput = {
  lead: AuditLead;
  pipelinePath: string;
  sandboxRoot: string;
  reportDir: string;
  repositoryClient: RepositorySandboxClient;
  modelClient: StrongReasoningAuditClient;
};

export async function runHardcoreAudit(_input: RunHardcoreAuditInput): Promise<AuditReport> {
  throw new HardCoreAuditorNotImplementedError("runHardcoreAudit");
}
