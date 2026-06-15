import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

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
  error?: string;
};

export type RunHardcoreAuditInput = {
  lead: AuditLead;
  pipelinePath: string;
  sandboxRoot: string;
  reportDir: string;
  repositoryClient: RepositorySandboxClient;
  modelClient: StrongReasoningAuditClient;
};

type AuditModelPayload = Omit<AuditReport, "repo" | "markdown_path">;

const auditSystemPrompt = [
  "你是 Project Sentinel 第三层强推理架构审计器。",
  "剥离开源项目的营销包装，只审查源码和可验证架构事实。",
  "核心判断：渲染核心究竟是相对坐标算法/弹性布局约束，还是 Prompt 硬猜位置。",
  "必须返回严格 JSON，不要 Markdown，不要代码块，不要解释性前后缀。",
  "字段：verdict, evidence, confidence, integration.estimated_glue_code_lines, integration.supports_zero_dependency_export, integration.friction_score, boundary_risks。"
].join("\n");

function safeRepoName(repo: string) {
  return repo.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function fsyncPath(path: string) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `${safeRepoName(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fsyncPath(tmpPath);
    await rename(tmpPath, path);
    await fsyncPath(dirname(path));
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

function sourceDigestFrom(source: { readme?: string; sourceFiles: Array<{ path: string; content: string }> }) {
  const readme = source.readme ? `README.md\n${source.readme.slice(0, 2_000)}` : "";
  const files = source.sourceFiles
    .map((file) => `${file.path}\n${file.content.slice(0, 4_000)}`)
    .join("\n\n---\n\n");
  return [readme, files].filter(Boolean).join("\n\n---\n\n");
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("Invalid audit model response: JSON object not found");
  }

  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function assertModelPayload(value: unknown): asserts value is AuditModelPayload {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid audit model response: expected object");
  }

  const payload = value as Partial<AuditModelPayload>;
  const verdicts = new Set<AuditVerdict>(["REAL_LAYOUT_ENGINE", "PROMPT_POSITIONING", "UNCLEAR"]);

  if (
    !verdicts.has(String(payload.verdict) as AuditVerdict) ||
    !Array.isArray(payload.evidence) ||
    typeof payload.confidence !== "number" ||
    !payload.integration ||
    typeof payload.integration.estimated_glue_code_lines !== "number" ||
    typeof payload.integration.supports_zero_dependency_export !== "boolean" ||
    typeof payload.integration.friction_score !== "number" ||
    !Array.isArray(payload.boundary_risks)
  ) {
    throw new Error("Invalid audit model response: contract fields missing");
  }
}

function parseAuditPayload(raw: string): AuditModelPayload {
  const parsed = extractJsonObject(raw);
  assertModelPayload(parsed);
  return parsed;
}

function markdownFor(input: { lead: AuditLead; report: AuditReport; status: "COMPLETED" | "AUDIT_FAILED" }) {
  const lines = [
    `# ${input.lead.title}`,
    "",
    `Repo: ${input.report.repo}`,
    `Status: ${input.status}`,
    `Verdict: ${input.report.verdict}`,
    `Confidence: ${input.report.confidence}`,
    "",
    "## Integration Friction",
    "",
    `Estimated Glue Code Lines: ${input.report.integration.estimated_glue_code_lines}`,
    `Zero Dependency Export: ${input.report.integration.supports_zero_dependency_export ? "yes" : "no"}`,
    `Friction Score: ${input.report.integration.friction_score}`,
    "",
    "## Evidence",
    "",
    ...input.report.evidence.map((item) => `- ${item}`),
    "",
    "## Boundary Risks",
    "",
    ...input.report.boundary_risks.map((item) => `- ${item}`)
  ];

  if (input.report.error) {
    lines.push("", "## Error", "", "```", input.report.error, "```");
  }

  return `${lines.join("\n")}\n`;
}

async function writeMarkdown(path: string, body: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

async function mutatePipelineLead(pipelinePath: string, repo: string, mutator: (lead: Record<string, unknown>) => Record<string, unknown>) {
  const parsed = JSON.parse(await readFile(pipelinePath, "utf8")) as { leads?: Array<Record<string, unknown>> };
  const leads = Array.isArray(parsed.leads) ? parsed.leads : [];
  parsed.leads = leads.map((lead) => (lead.repo === repo ? mutator(lead) : lead));
  await writeJsonAtomic(pipelinePath, parsed);
}

function fallbackReport(repo: string, markdownPath: string, error: unknown): AuditReport {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.trim() : String(error);
  return {
    repo,
    verdict: "UNCLEAR",
    evidence: [],
    confidence: 0,
    integration: {
      estimated_glue_code_lines: 0,
      supports_zero_dependency_export: false,
      friction_score: 1
    },
    boundary_risks: ["audit execution failed"],
    markdown_path: markdownPath,
    error: message
  };
}

export async function runHardcoreAudit(input: RunHardcoreAuditInput): Promise<AuditReport> {
  const safeRepo = safeRepoName(input.lead.repo);
  const sandboxDir = join(input.sandboxRoot, safeRepo);
  const reportPath = join(input.reportDir, safeRepo, "audit_report.md");

  try {
    await mkdir(sandboxDir, { recursive: true });
    const source = await input.repositoryClient.checkout({
      repo: input.lead.repo,
      destination: sandboxDir
    });
    const sourceDigest = sourceDigestFrom(source);
    const raw = await input.modelClient.audit({
      systemPrompt: auditSystemPrompt,
      repo: input.lead.repo,
      sourceDigest
    });
    const payload = parseAuditPayload(raw);
    const report: AuditReport = {
      repo: input.lead.repo,
      markdown_path: reportPath,
      ...payload
    };

    await mutatePipelineLead(input.pipelinePath, input.lead.repo, (lead) => ({
      ...lead,
      audit_status: "COMPLETED",
      audit_report: report
    }));
    await writeMarkdown(reportPath, markdownFor({ lead: input.lead, report, status: "COMPLETED" }));

    return report;
  } catch (error) {
    const report = fallbackReport(input.lead.repo, reportPath, error);
    await mutatePipelineLead(input.pipelinePath, input.lead.repo, (lead) => ({
      ...lead,
      audit_status: "AUDIT_FAILED",
      audit_report: report
    }));
    await writeMarkdown(reportPath, markdownFor({ lead: input.lead, report, status: "AUDIT_FAILED" }));
    return report;
  }
}
