import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rm, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "NotImplementedError";
  }
}

export type PipelineState = {
  version: 1;
  run_id: string;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SHUTDOWN_REQUESTED";
  cursor: string | null;
  updated_at: string;
};

export type AtomicWriteHooks = {
  afterTempWrite?: (tmpPath: string) => Promise<void> | void;
  beforeReplace?: (tmpPath: string, targetPath: string) => Promise<void> | void;
};

const lockPollMs = 5;
const activeWrites = new Set<Promise<void>>();
const installedSignalHandlers = new Map<string, { sigint: () => void; sigterm: () => void }>();

function assertPipelineState(value: unknown): asserts value is PipelineState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid pipeline state: expected object");
  }

  const state = value as Partial<PipelineState>;
  const allowedStates = new Set(["PENDING", "RUNNING", "COMPLETED", "FAILED", "SHUTDOWN_REQUESTED"]);

  if (
    state.version !== 1 ||
    typeof state.run_id !== "string" ||
    !allowedStates.has(String(state.state)) ||
    !(typeof state.cursor === "string" || state.cursor === null) ||
    typeof state.updated_at !== "string"
  ) {
    throw new Error("Invalid pipeline state contract");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockPathFor(path: string) {
  return join(dirname(path), `${basename(path)}.lock`);
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

async function withFileLock(path: string, work: () => Promise<void>) {
  const lockPath = await acquireLock(path);
  try {
    await work();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function createTempPath(path: string) {
  return join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.json.tmp`);
}

async function cleanupTempFiles(path: string) {
  const dir = dirname(path);
  const base = basename(path);
  const names = await readdir(dir).catch(() => []);

  await Promise.all(
    names
      .filter((name) => name.startsWith(`${base}.`) && name.endsWith(".tmp"))
      .map((name) => rm(join(dir, name), { force: true }))
  );
}

async function trackWrite(work: () => Promise<void>) {
  const pending = work();
  activeWrites.add(pending);
  try {
    await pending;
  } finally {
    activeWrites.delete(pending);
  }
}

export async function loadPipelineState(path: string): Promise<PipelineState> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  assertPipelineState(parsed);
  return parsed;
}

export async function writePipelineStateAtomic(
  path: string,
  state: PipelineState,
  hooks: AtomicWriteHooks = {}
): Promise<void> {
  assertPipelineState(state);

  await trackWrite(async () => {
    await withFileLock(path, async () => {
      const tmpPath = createTempPath(path);

      try {
        const bytes = `${JSON.stringify(state, null, 2)}\n`;
        await writeFile(tmpPath, bytes, "utf8");
        await fsyncFile(tmpPath);
        await hooks.afterTempWrite?.(tmpPath);
        await hooks.beforeReplace?.(tmpPath, path);
        await rename(tmpPath, path);
        await fsyncDirectory(dirname(path));
      } catch (error) {
        await rm(tmpPath, { force: true });
        throw error;
      }
    });
  });
}

export async function mutatePipelineStateAtomic(
  path: string,
  mutator: (current: PipelineState) => PipelineState,
  hooks: AtomicWriteHooks = {}
): Promise<void> {
  await trackWrite(async () => {
    await withFileLock(path, async () => {
      const current = await loadPipelineState(path);
      const next = mutator(current);
      assertPipelineState(next);

      const tmpPath = createTempPath(path);
      try {
        const bytes = `${JSON.stringify(next, null, 2)}\n`;
        await writeFile(tmpPath, bytes, "utf8");
        await fsyncFile(tmpPath);
        await hooks.afterTempWrite?.(tmpPath);
        await hooks.beforeReplace?.(tmpPath, path);
        await rename(tmpPath, path);
        await fsyncDirectory(dirname(path));
      } catch (error) {
        await rm(tmpPath, { force: true });
        throw error;
      }
    });
  });
}

export async function handleGracefulShutdown(path: string, _signal: "SIGINT" | "SIGTERM"): Promise<void> {
  await cleanupTempFiles(path);
}

export function installPipelineSignalHandlers(path: string) {
  if (installedSignalHandlers.has(path)) return;

  const sigint = () => {
    void Promise.allSettled([...activeWrites])
      .then(() => handleGracefulShutdown(path, "SIGINT"))
      .finally(() => {
        process.exitCode = 130;
      });
  };
  const sigterm = () => {
    void Promise.allSettled([...activeWrites])
      .then(() => handleGracefulShutdown(path, "SIGTERM"))
      .finally(() => {
        process.exitCode = 143;
      });
  };

  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  installedSignalHandlers.set(path, { sigint, sigterm });
}
