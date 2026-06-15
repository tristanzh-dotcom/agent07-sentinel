import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handleGracefulShutdown,
  loadPipelineState,
  mutatePipelineStateAtomic,
  PipelineState,
  writePipelineStateAtomic
} from "../../src/sentinel/storageBase.js";

let root: string;
let pipelinePath: string;

const pendingState: PipelineState = {
  version: 1,
  run_id: "run-existing",
  state: "PENDING",
  cursor: "github:page:2",
  updated_at: "2026-06-15T08:00:00+08:00"
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sentinel-storage-"));
  pipelinePath = join(root, "scout_pipeline.json");
  await writeFile(pipelinePath, `${JSON.stringify(pendingState, null, 2)}\n`, "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readPipelineJson(): Promise<PipelineState> {
  return JSON.parse(await readFile(pipelinePath, "utf8")) as PipelineState;
}

async function listTempFiles() {
  return (await readdir(root)).filter((name) => name.includes(".json.tmp") || name.endsWith(".tmp"));
}

describe("Milestone 1 storage base TDD contract", () => {
  it("loads an existing PENDING checkpoint instead of overwriting or resetting it", async () => {
    const loaded = await loadPipelineState(pipelinePath);

    expect(loaded).toEqual(pendingState);
    expect(await readPipelineJson()).toEqual(pendingState);
  });

  it("keeps scout_pipeline.json parseable during high-frequency concurrent atomic writes", async () => {
    const writes = Array.from({ length: 40 }, (_, index) =>
      mutatePipelineStateAtomic(pipelinePath, (current: PipelineState) => ({
        ...current,
        run_id: `run-concurrent-${index}`,
        state: "RUNNING",
        cursor: `cursor:${index}`,
        updated_at: `2026-06-15T08:00:${String(index).padStart(2, "0")}+08:00`
      }))
    );

    await Promise.all(writes);

    const finalState = await readPipelineJson();
    expect(finalState.version).toBe(1);
    expect(finalState.state).toBe("RUNNING");
    expect(finalState.run_id).toMatch(/^run-concurrent-/);
    expect(finalState.cursor).toMatch(/^cursor:/);
    expect(await listTempFiles()).toEqual([]);
  });

  it("uses a temporary json file before atomic replacement and never exposes partial json", async () => {
    const nextState: PipelineState = {
      version: 1,
      run_id: "run-next",
      state: "RUNNING",
      cursor: "github:page:3",
      updated_at: "2026-06-15T08:01:00+08:00"
    };

    const observedTmpPaths: string[] = [];

    await writePipelineStateAtomic(pipelinePath, nextState, {
      afterTempWrite: async (tmpPath: string) => {
        observedTmpPaths.push(tmpPath);
        expect(tmpPath).toContain("scout_pipeline.json");
        expect(tmpPath.endsWith(".tmp")).toBe(true);
        expect(await readPipelineJson()).toEqual(pendingState);
      }
    });

    expect(observedTmpPaths).toHaveLength(1);
    expect(await readPipelineJson()).toEqual(nextState);
    expect(await listTempFiles()).toEqual([]);
  });

  it("preserves the previous valid checkpoint and cleans temp files when SIGTERM interrupts before replace", async () => {
    const interruptedState: PipelineState = {
      version: 1,
      run_id: "run-interrupted",
      state: "RUNNING",
      cursor: "github:page:9",
      updated_at: "2026-06-15T08:02:00+08:00"
    };

    await expect(
      writePipelineStateAtomic(pipelinePath, interruptedState, {
        beforeReplace: async () => {
          await handleGracefulShutdown(pipelinePath, "SIGTERM");
          throw new Error("simulated SIGTERM before replace");
        }
      })
    ).rejects.toThrow("simulated SIGTERM before replace");

    expect(await readPipelineJson()).toEqual(pendingState);
    expect(await listTempFiles()).toEqual([]);
  });

  it("preserves the previous valid checkpoint and cleans temp files when SIGINT interrupts before replace", async () => {
    const interruptedState: PipelineState = {
      version: 1,
      run_id: "run-interrupted-int",
      state: "RUNNING",
      cursor: "github:page:10",
      updated_at: "2026-06-15T08:03:00+08:00"
    };

    await expect(
      writePipelineStateAtomic(pipelinePath, interruptedState, {
        beforeReplace: async () => {
          await handleGracefulShutdown(pipelinePath, "SIGINT");
          throw new Error("simulated SIGINT before replace");
        }
      })
    ).rejects.toThrow("simulated SIGINT before replace");

    expect(await readPipelineJson()).toEqual(pendingState);
    expect(await listTempFiles()).toEqual([]);
  });
});
