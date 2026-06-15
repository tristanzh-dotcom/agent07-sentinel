import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditLead,
  runHardcoreAudit,
  StrongReasoningAuditClient,
  RepositorySandboxClient
} from "../../src/sentinel/hardcoreAuditor.js";

let root: string;
let pipelinePath: string;
let sandboxRoot: string;
let reportDir: string;

function makeLead(): AuditLead {
  return {
    id: "lead-vector-ppt",
    repo: "github/designer-ai/vector-ppt-engine",
    title: "Vector PPT Engine",
    status: "APPROVED",
    audit_status: "AUDITING",
    locked: true
  };
}

function modelPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    verdict: "REAL_LAYOUT_ENGINE",
    evidence: [
      "core/layout.ts exposes relative coordinate constraints",
      "render/export.ts supports deterministic HTML and PDF export"
    ],
    confidence: 0.91,
    integration: {
      estimated_glue_code_lines: 84,
      supports_zero_dependency_export: true,
      friction_score: 0.18
    },
    boundary_risks: ["long multilingual text overflow", "SVG font fallback mismatch"],
    ...overrides
  });
}

async function seedPipeline() {
  await writeFile(
    pipelinePath,
    `${JSON.stringify(
      {
        version: 1,
        run_id: "run-tier3-red",
        updated_at: "2026-06-15T13:20:00+08:00",
        leads: [
          {
            ...makeLead(),
            author: "designer-ai",
            token_roi_estimate: 0.38
          }
        ],
        blacklist: {
          repos: [],
          authors: []
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-hardcore-auditor-"));
  pipelinePath = join(root, "scout_pipeline.json");
  sandboxRoot = join(root, "sandboxes");
  reportDir = join(root, "reports");
  await seedPipeline();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Tier-3 hard-core auditor TDD contract", () => {
  it("checks out the approved repo inside an isolated sandbox before calling the strong reasoning model", async () => {
    const repositoryClient: RepositorySandboxClient = {
      checkout: vi.fn(async () => ({
        readme: "# Vector PPT Engine",
        sourceFiles: [{ path: "core/layout.ts", content: "export const relativeGrid = true;" }]
      }))
    };
    const modelClient: StrongReasoningAuditClient = {
      audit: vi.fn(async () => modelPayload())
    };

    await runHardcoreAudit({
      lead: makeLead(),
      pipelinePath,
      sandboxRoot,
      reportDir,
      repositoryClient,
      modelClient
    });

    expect(repositoryClient.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "github/designer-ai/vector-ppt-engine",
        destination: expect.stringContaining(join("sandboxes", "github_designer-ai_vector-ppt-engine"))
      })
    );
    expect(modelClient.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: "github/designer-ai/vector-ppt-engine",
        systemPrompt: expect.stringContaining("剥离开源项目的营销包装"),
        sourceDigest: expect.stringContaining("core/layout.ts")
      })
    );
  });

  it("parses the anti-fraud verdict, integration friction, and boundary risks into the pipeline audit_report field", async () => {
    const repositoryClient: RepositorySandboxClient = {
      checkout: vi.fn(async () => ({
        sourceFiles: [
          { path: "core/layout.ts", content: "function layout(node) { return node.x / parent.width; }" },
          { path: "render/export.ts", content: "exportHtml(); exportPdf();" }
        ]
      }))
    };
    const modelClient: StrongReasoningAuditClient = {
      audit: vi.fn(async () => modelPayload())
    };

    const report = await runHardcoreAudit({
      lead: makeLead(),
      pipelinePath,
      sandboxRoot,
      reportDir,
      repositoryClient,
      modelClient
    });

    const pipeline = JSON.parse(await readFile(pipelinePath, "utf8"));
    const auditedLead = pipeline.leads.find((lead: { repo: string }) => lead.repo === "github/designer-ai/vector-ppt-engine");

    expect(report).toMatchObject({
      repo: "github/designer-ai/vector-ppt-engine",
      verdict: "REAL_LAYOUT_ENGINE",
      confidence: 0.91,
      integration: {
        estimated_glue_code_lines: 84,
        supports_zero_dependency_export: true,
        friction_score: 0.18
      },
      boundary_risks: ["long multilingual text overflow", "SVG font fallback mismatch"]
    });
    expect(auditedLead.audit_status).toBe("COMPLETED");
    expect(auditedLead.audit_report).toMatchObject({
      verdict: "REAL_LAYOUT_ENGINE",
      evidence: expect.arrayContaining(["core/layout.ts exposes relative coordinate constraints"]),
      integration: expect.objectContaining({ estimated_glue_code_lines: 84 }),
      boundary_risks: expect.arrayContaining(["long multilingual text overflow"])
    });
  });

  it("writes a readable audit_report.md artifact that preserves the hard-core audit decision", async () => {
    const repositoryClient: RepositorySandboxClient = {
      checkout: vi.fn(async () => ({
        readme: "# Prompt-only slide generator",
        sourceFiles: [{ path: "index.ts", content: "llm.generate('place this box around x=120 y=80')" }]
      }))
    };
    const modelClient: StrongReasoningAuditClient = {
      audit: vi.fn(async () =>
        modelPayload({
          verdict: "PROMPT_POSITIONING",
          confidence: 0.86,
          evidence: ["index.ts delegates positioning to prompt text instead of layout constraints"],
          integration: {
            estimated_glue_code_lines: 260,
            supports_zero_dependency_export: false,
            friction_score: 0.74
          },
          boundary_risks: ["coordinates drift across regenerated slides"]
        })
      )
    };

    const report = await runHardcoreAudit({
      lead: makeLead(),
      pipelinePath,
      sandboxRoot,
      reportDir,
      repositoryClient,
      modelClient
    });

    const markdown = await readFile(report.markdown_path, "utf8");

    expect(report.markdown_path).toMatch(/audit_report\.md$/);
    expect(markdown).toContain("# Vector PPT Engine");
    expect(markdown).toContain("PROMPT_POSITIONING");
    expect(markdown).toContain("Estimated Glue Code Lines: 260");
    expect(markdown).toContain("coordinates drift across regenerated slides");
  });

  it("marks the audit as AUDIT_FAILED and writes a diagnostic placeholder report when the model output is invalid", async () => {
    const repositoryClient: RepositorySandboxClient = {
      checkout: vi.fn(async () => ({
        sourceFiles: [{ path: "index.ts", content: "export const layout = 'unknown';" }]
      }))
    };
    const modelClient: StrongReasoningAuditClient = {
      audit: vi.fn(async () => "```markdown\nI cannot provide structured JSON today.\n```")
    };

    const report = await runHardcoreAudit({
      lead: makeLead(),
      pipelinePath,
      sandboxRoot,
      reportDir,
      repositoryClient,
      modelClient
    });

    const pipeline = JSON.parse(await readFile(pipelinePath, "utf8"));
    const auditedLead = pipeline.leads.find((lead: { repo: string }) => lead.repo === "github/designer-ai/vector-ppt-engine");
    const markdown = await readFile(report.markdown_path, "utf8");

    expect(report).toMatchObject({
      repo: "github/designer-ai/vector-ppt-engine",
      verdict: "UNCLEAR",
      confidence: 0,
      boundary_risks: expect.arrayContaining(["audit execution failed"])
    });
    expect(auditedLead.audit_status).toBe("AUDIT_FAILED");
    expect(auditedLead.audit_report).toMatchObject({
      verdict: "UNCLEAR",
      error: expect.stringContaining("Invalid audit model response")
    });
    expect(markdown).toContain("AUDIT_FAILED");
    expect(markdown).toContain("Invalid audit model response");
  });
});
