import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";

export class ArtifactCapturerNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "ArtifactCapturerNotImplementedError";
  }
}

export type ArtifactMediaKind = "image" | "pdf" | "video";
export type ArtifactCaptureStatus = "PENDING" | "CAPTURING" | "CAPTURED" | "FALLBACK_USED" | "CLEANUP_PENDING" | "CLEANED" | "FAILED_TERMINAL";

export type ArtifactLead = {
  id: string;
  repo: string;
  title: string;
};

export type ArtifactSource = {
  kind: ArtifactMediaKind;
  url: string;
  index: number;
};

export type DownloadedArtifact = {
  bytes: Uint8Array;
  mimeType: string;
};

export type DashboardPreview = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  extension: "png" | "jpg" | "webp" | "svg";
};

export type ArtifactDownloader = {
  download: (source: ArtifactSource, context: { signal: AbortSignal; timeoutMs: number }) => Promise<DownloadedArtifact>;
};

export type ArtifactMediaProcessor = {
  toDashboardPreview: (artifact: DownloadedArtifact, source: ArtifactSource) => Promise<DashboardPreview>;
};

export type ArtifactFilesystem = {
  removeDir: (path: string) => Promise<void>;
};

export type ArtifactCapturerConfig = {
  artifactRoot: string;
  fallbackLocalThumbPath: string;
  maxConcurrentDownloadsPerRepo: number;
  downloadTimeoutMs: number;
  maxArtifactsKeptPerRepo: number;
};

export type CaptureArtifactsInput = {
  lead: ArtifactLead;
  sources: ArtifactSource[];
  pipelinePath: string;
  config: ArtifactCapturerConfig;
  downloader: ArtifactDownloader;
  mediaProcessor: ArtifactMediaProcessor;
};

export type ArtifactCaptureError = {
  code: string;
  source_url: string;
  message: string;
};

export type ArtifactCaptureResult = {
  repo: string;
  status: ArtifactCaptureStatus;
  local_thumb_path: string;
  errors: ArtifactCaptureError[];
};

export type CleanupRejectedRepoInput = {
  repo: string;
  artifactRoot: string;
  fileSystem: ArtifactFilesystem;
};

type CapturedPreview = {
  source: ArtifactSource;
  preview: DashboardPreview;
  servedPath: string;
  localPath: string;
};

function safeRepoKey(repo: string) {
  return repo.toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
}

function timeoutMsFrom(config: ArtifactCapturerConfig) {
  return Math.min(config.downloadTimeoutMs, 5000);
}

function errorCodeFor(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: number }).status;
    const name = (error as { name?: string }).name;
    if (status === 404) return "REMOTE_404";
    if (name === "AbortError") return "REMOTE_TIMEOUT";
  }
  return "DECODE_FAILED";
}

function errorMessageFor(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const tmpPath = join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
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

async function mutatePipelineArtifacts(
  pipelinePath: string,
  repo: string,
  artifacts: {
    local_thumb_path: string;
    status: ArtifactCaptureStatus;
    errors: ArtifactCaptureError[];
  }
) {
  const parsed = JSON.parse(await readFile(pipelinePath, "utf8")) as { leads?: Array<Record<string, unknown>> };
  parsed.leads = Array.isArray(parsed.leads)
    ? parsed.leads.map((lead) => (lead.repo === repo ? { ...lead, artifacts } : lead))
    : [];
  await writeJsonAtomic(pipelinePath, parsed);
}

async function writePreview(root: string, repoKey: string, source: ArtifactSource, preview: DashboardPreview): Promise<CapturedPreview> {
  const repoDir = join(root, repoKey);
  await mkdir(repoDir, { recursive: true });
  const filename = `${String(source.index).padStart(2, "0")}_${source.kind}_${randomUUID()}.${preview.extension}`;
  const localPath = join(repoDir, filename);
  await writeFile(localPath, preview.bytes);

  return {
    source,
    preview,
    servedPath: `/agent07-artifacts/storage/${repoKey}/${filename}`,
    localPath
  };
}

async function captureOne(input: CaptureArtifactsInput, source: ArtifactSource, repoKey: string): Promise<CapturedPreview | ArtifactCaptureError> {
  const abortController = new AbortController();
  const timeoutMs = timeoutMsFrom(input.config);
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const downloaded = await input.downloader.download(source, {
      signal: abortController.signal,
      timeoutMs
    });
    const preview = await input.mediaProcessor.toDashboardPreview(downloaded, source);
    return await writePreview(input.config.artifactRoot, repoKey, source, preview);
  } catch (error) {
    return {
      code: errorCodeFor(error),
      source_url: source.url,
      message: errorMessageFor(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  });

  await Promise.all(workers);
}

export async function captureArtifactsForLead(input: CaptureArtifactsInput): Promise<ArtifactCaptureResult> {
  const repoKey = safeRepoKey(input.lead.repo);
  const captured: CapturedPreview[] = [];
  const errors: ArtifactCaptureError[] = [];
  const sources = input.sources.slice(0, Math.max(input.config.maxArtifactsKeptPerRepo, input.sources.length));

  const initialStateWrite = mutatePipelineArtifacts(input.pipelinePath, input.lead.repo, {
    local_thumb_path: input.config.fallbackLocalThumbPath,
    status: "CAPTURING",
    errors: []
  }).catch((error: unknown) => error);

  await runPool(sources, input.config.maxConcurrentDownloadsPerRepo, async (source) => {
    if (captured.length >= input.config.maxArtifactsKeptPerRepo) return;
    const result = await captureOne(input, source, repoKey);
    if ("servedPath" in result) {
      if (captured.length < input.config.maxArtifactsKeptPerRepo) {
        captured.push(result);
      }
    } else {
      errors.push(result);
    }
  });

  const localThumbPath = captured[0]?.servedPath ?? input.config.fallbackLocalThumbPath;
  const status: ArtifactCaptureStatus = captured.length > 0 ? "CAPTURED" : "FALLBACK_USED";
  const initialWriteResult = await initialStateWrite;
  if (initialWriteResult instanceof Error) throw initialWriteResult;

  await mutatePipelineArtifacts(input.pipelinePath, input.lead.repo, {
    local_thumb_path: localThumbPath,
    status,
    errors
  });

  return {
    repo: input.lead.repo,
    status,
    local_thumb_path: localThumbPath,
    errors
  };
}

export async function cleanupArtifactsForRejectedRepo(input: CleanupRejectedRepoInput): Promise<void> {
  const root = resolve(input.artifactRoot);
  const repoKey = safeRepoKey(input.repo);
  if (!repoKey) {
    throw new Error("Refusing to delete artifact sandbox for empty repo key");
  }
  const repoDir = resolve(root, repoKey);

  if (!repoDir.startsWith(`${root}${sep}`)) {
    throw new Error(`Refusing to delete outside artifact sandbox: ${repoDir}`);
  }

  await input.fileSystem.removeDir(repoDir);
}
