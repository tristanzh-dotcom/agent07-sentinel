import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactDownloader,
  ArtifactCaptureResult,
  ArtifactLead,
  ArtifactMediaProcessor,
  ArtifactSource,
  DashboardPreview,
  DownloadedArtifact,
  captureArtifactsForLead,
  cleanupArtifactsForRejectedRepo
} from "../../src/sentinel/artifactCapturer.js";

let root: string;
let artifactRoot: string;
let pipelinePath: string;

const fallbackLocalThumbPath = "./storage/assets/dark_fallback.png";

function makeLead(overrides: Partial<ArtifactLead> = {}): ArtifactLead {
  return {
    id: "lead-capturer",
    repo: "mock-repo",
    title: "Mock Repo",
    ...overrides
  };
}

function makeImageSources(count: number): ArtifactSource[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "image",
    url: `https://cdn.example.test/mock-repo/artifact-${index}.png`,
    index
  }));
}

async function seedPipeline() {
  await writeFile(
    pipelinePath,
    `${JSON.stringify(
      {
        version: 1,
        run_id: "run-capturer-red",
        updated_at: "2026-06-16T09:00:00+08:00",
        leads: [
          {
            ...makeLead(),
            status: "PENDING",
            audit_status: "IDLE",
            locked: false,
            artifacts: {
              local_thumb_path: fallbackLocalThumbPath,
              status: "PENDING",
              errors: []
            }
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
  root = await mkdtemp(join(tmpdir(), "sentinel-capturer-"));
  artifactRoot = join(root, "storage", "artifacts");
  pipelinePath = join(root, "scout_pipeline.json");
  await mkdir(artifactRoot, { recursive: true });
  await seedPipeline();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

describe("Automated Artifact Capturer TDD contract", () => {
  it("enforces per-repo concurrency and aborts hung downloads at 5000ms without deadlocking queued images", async () => {
    vi.useFakeTimers();

    let activeDownloads = 0;
    let maxObservedConcurrency = 0;
    const abortedUrls: string[] = [];
    const completedUrls: string[] = [];
    const downloader: ArtifactDownloader = {
      download: vi.fn((source, context): Promise<DownloadedArtifact> => {
        activeDownloads += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeDownloads);

        if (source.index < 2) {
          return new Promise<DownloadedArtifact>((_, reject) => {
            context.signal.addEventListener("abort", () => {
              activeDownloads -= 1;
              abortedUrls.push(source.url);
              reject(Object.assign(new Error("download timeout"), { name: "AbortError" }));
            });
          });
        }

        activeDownloads -= 1;
        completedUrls.push(source.url);
        return Promise.resolve({
          bytes: new Uint8Array([source.index]),
          mimeType: "image/png"
        });
      })
    };
    const mediaProcessor: ArtifactMediaProcessor = {
      toDashboardPreview: vi.fn(
        async (artifact): Promise<DashboardPreview> => ({
          bytes: artifact.bytes,
          mimeType: "image/png",
          extension: "png"
        })
      )
    };

    const capture = captureArtifactsForLead({
      lead: makeLead(),
      sources: makeImageSources(10),
      pipelinePath,
      config: {
        artifactRoot,
        fallbackLocalThumbPath,
        maxConcurrentDownloadsPerRepo: 2,
        downloadTimeoutMs: 5000,
        maxArtifactsKeptPerRepo: 5
      },
      downloader,
      mediaProcessor
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(5000);
    const resultOrError = await capture;
    if (resultOrError instanceof Error) throw resultOrError;
    const result = resultOrError as ArtifactCaptureResult;

    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(abortedUrls).toHaveLength(2);
    expect(completedUrls.length).toBeGreaterThan(0);
    expect(result.status).toBe("CAPTURED");
  });

  it("physically deletes the rejected repo artifact sandbox through the cleanup filesystem adapter", async () => {
    const repoDir = join(artifactRoot, "mock-repo");
    await mkdir(repoDir, { recursive: true });
    await Promise.all([
      writeFile(join(repoDir, "thumb-1.png"), "one"),
      writeFile(join(repoDir, "thumb-2.png"), "two"),
      writeFile(join(repoDir, "thumb-3.png"), "three")
    ]);
    const fileSystem = {
      removeDir: vi.fn(async (path: string) => {
        await rm(path, { recursive: true, force: true });
      })
    };

    await cleanupArtifactsForRejectedRepo({
      repo: "mock-repo",
      artifactRoot,
      fileSystem
    });

    expect(fileSystem.removeDir).toHaveBeenCalledWith(repoDir);
    await expect(stat(repoDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps corrupt PDF and 404 image failures to the local fallback placeholder without uncaught exceptions", async () => {
    const sources: ArtifactSource[] = [
      {
        kind: "image",
        url: "https://cdn.example.test/missing.png",
        index: 0
      },
      {
        kind: "pdf",
        url: "https://cdn.example.test/broken.pdf",
        index: 1
      }
    ];
    const downloader: ArtifactDownloader = {
      download: vi.fn(async (source) => {
        if (source.kind === "image") {
          throw Object.assign(new Error("remote image missing"), { status: 404 });
        }
        return {
          bytes: new Uint8Array([37, 80, 68, 70]),
          mimeType: "application/pdf"
        };
      })
    };
    const mediaProcessor: ArtifactMediaProcessor = {
      toDashboardPreview: vi.fn(async () => {
        throw new Error("mock pdf renderer crashed");
      })
    };

    const result = await captureArtifactsForLead({
      lead: makeLead(),
      sources,
      pipelinePath,
      config: {
        artifactRoot,
        fallbackLocalThumbPath,
        maxConcurrentDownloadsPerRepo: 2,
        downloadTimeoutMs: 5000,
        maxArtifactsKeptPerRepo: 5
      },
      downloader,
      mediaProcessor
    });

    const pipeline = JSON.parse(await readFile(pipelinePath, "utf8"));
    const lead = pipeline.leads.find((item: { repo: string }) => item.repo === "mock-repo");

    expect(result.status).toBe("FALLBACK_USED");
    expect(result.local_thumb_path).toBe(fallbackLocalThumbPath);
    expect(lead.artifacts.local_thumb_path).toBe(fallbackLocalThumbPath);
    expect(lead.artifacts.status).toBe("FALLBACK_USED");
    expect(lead.artifacts.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "REMOTE_404" }),
        expect.objectContaining({ code: "DECODE_FAILED" })
      ])
    );
  });
});
