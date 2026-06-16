import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { parseRuntimeCliArgs, runRuntimeOrchestratorCli } from "../../src/sentinel/runtimeOrchestratorCli.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");

describe("Runtime Orchestrator CLI production entry", () => {
  it("exposes npm run sentinel:daily as the production runtime entrypoint", async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["sentinel:daily"]).toContain("runtimeOrchestratorCli.ts");
  });

  it("parses default invocation as dry-run with live network, model, and publish disabled", () => {
    const parsed = parseRuntimeCliArgs([], {
      cwd: projectRoot,
      now: () => new Date("2026-06-16T08:30:00.000Z")
    });

    expect(parsed.gates).toEqual({
      dry_run: true,
      live_network: false,
      live_model: false,
      live_publish: false
    });
    expect(parsed.mode).toBe("DRY_RUN");
    expect(parsed.run_id).toBe("runtime_20260616T083000Z");
  });

  it("routes --live-network=true through the live source adapter without live model or publish by default", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      headers: new Headers({ "x-ratelimit-remaining": "29" }),
      text: async () =>
        JSON.stringify({
          total_count: 0,
          incomplete_results: false,
          items: []
        })
    }));

    const result = await runRuntimeOrchestratorCli({
      argv: ["--live-network=true", "--run-id", "runtime_20260616T083000Z", "--date", "2026-06-16"],
      cwd: projectRoot,
      env: {},
      now: () => new Date("2026-06-16T08:30:00.000Z"),
      fetchImpl,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line)
    });

    expect(result.routing).toMatchObject({
      source_adapter: "live",
      model_adapter: "mock",
      publish_adapter: "shadow_only"
    });
    expect(result.status).toBe("DRY_RUN_COMPLETED");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("https://api.github.com/search/repositories"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json"
        })
      })
    );
    expect(stdout.at(-1)).toContain('"status":"DRY_RUN_COMPLETED"');
    expect(stderr).toEqual([]);
  });
});

