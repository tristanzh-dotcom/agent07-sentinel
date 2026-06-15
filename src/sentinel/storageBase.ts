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

export async function loadPipelineState(_path: string): Promise<PipelineState> {
  throw new NotImplementedError("loadPipelineState");
}

export async function writePipelineStateAtomic(
  _path: string,
  _state: PipelineState,
  _hooks: AtomicWriteHooks = {}
): Promise<void> {
  throw new NotImplementedError("writePipelineStateAtomic");
}

export async function mutatePipelineStateAtomic(
  _path: string,
  _mutator: (current: PipelineState) => PipelineState,
  _hooks: AtomicWriteHooks = {}
): Promise<void> {
  throw new NotImplementedError("mutatePipelineStateAtomic");
}

export async function handleGracefulShutdown(_path: string, _signal: "SIGINT" | "SIGTERM"): Promise<void> {
  throw new NotImplementedError("handleGracefulShutdown");
}
