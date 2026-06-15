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

export async function captureArtifactsForLead(_input: CaptureArtifactsInput): Promise<ArtifactCaptureResult> {
  throw new ArtifactCapturerNotImplementedError("captureArtifactsForLead");
}

export async function cleanupArtifactsForRejectedRepo(_input: CleanupRejectedRepoInput): Promise<void> {
  throw new ArtifactCapturerNotImplementedError("cleanupArtifactsForRejectedRepo");
}
