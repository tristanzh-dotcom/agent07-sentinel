import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { createRealSourceAdapter, HttpJsonResult, HttpTextResult } from "./realSourceAdapter.js";
import {
  RuntimeCandidate,
  RuntimeConfig,
  RuntimeRunResult,
  runRuntimeOrchestrator
} from "./runtimeOrchestrator.js";
import { buildDefaultSourcePlanV2 } from "./sourcePlan.js";

type CliParseContext = {
  cwd: string;
  now: () => Date;
};

type CliRunInput = CliParseContext & {
  argv: string[];
  env: Record<string, string | undefined>;
  fetchImpl: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
    status: number;
    headers: Headers;
    text: () => Promise<string>;
  }>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type ParsedFlags = {
  dry_run?: boolean;
  live_network?: boolean;
  live_model?: boolean;
  live_publish?: boolean;
  date?: string;
  run_id?: string;
  max_candidates?: number;
};

function parseBoolean(value: string | undefined) {
  if (value === undefined) return true;
  return value === "true" || value === "1";
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const raw = current.slice(2);
    const [key, inlineValue] = raw.split("=", 2);
    const value = inlineValue ?? (argv[index + 1]?.startsWith("--") ? undefined : argv[index + 1]);
    if (inlineValue === undefined && value !== undefined) index += 1;

    if (key === "dry-run") flags.dry_run = parseBoolean(value);
    if (key === "live-network") flags.live_network = parseBoolean(value);
    if (key === "live-model") flags.live_model = parseBoolean(value);
    if (key === "live-publish") flags.live_publish = parseBoolean(value);
    if (key === "date" && value) flags.date = value;
    if (key === "run-id" && value) flags.run_id = value;
    if (key === "max-candidates" && value) flags.max_candidates = Number.parseInt(value, 10);
  }

  return flags;
}

function runIdFrom(now: Date) {
  return `runtime_${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

function dateFrom(now: Date) {
  return now.toISOString().slice(0, 10);
}

export function parseRuntimeCliArgs(argv: string[], context: CliParseContext): RuntimeConfig {
  const flags = parseFlags(argv);
  const now = context.now();
  const livePublish = flags.live_publish ?? false;
  const dryRun = flags.dry_run ?? !livePublish;
  const liveNetwork = flags.live_network ?? false;
  const liveModel = flags.live_model ?? false;
  const runId = flags.run_id ?? runIdFrom(now);
  const projectRoot = resolve(context.cwd);
  const runtimeShadowRoot = join(projectRoot, "storage", "runtime_shadow");
  const runShadowDir = join(runtimeShadowRoot, runId);
  const mode = livePublish && !dryRun ? "LIVE_PUBLISH" : liveNetwork ? "LIVE_COLLECT" : "DRY_RUN";

  return {
    version: 1,
    mode,
    date: flags.date ?? dateFrom(now),
    run_id: runId,
    gates: {
      dry_run: dryRun,
      live_network: liveNetwork,
      live_model: liveModel,
      live_publish: livePublish
    },
    paths: {
      project_root: projectRoot,
      runtime_shadow_root: runtimeShadowRoot,
      run_shadow_dir: runShadowDir,
      production_pipeline_path: join(projectRoot, "data", "scout_pipeline.json"),
      logs_dir: join(projectRoot, "storage", "logs")
    },
    limits: {
      max_candidates: flags.max_candidates ?? 20,
      max_selected_leads: 5,
      max_single_payload_tokens: 10_000,
      max_daily_tokens: 50_000
    }
  };
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

async function writeTextAtomic(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, value, "utf8");
  await rename(tmpPath, path);
}

function defaultSourcePlan(config: RuntimeConfig) {
  const sourcePlanV2 = buildDefaultSourcePlanV2({
    date: config.date,
    pushed_after: pushedAfterFor(config.date),
    min_stars_default: 100,
    min_stars_fresh_breakout: 20,
    max_candidates_before_blind_scout: config.limits.max_candidates,
    topics: ["layout-engine", "vector-graphics", "typesetting"]
  });

  return {
    version: 1 as const,
    date: config.date,
    max_candidates_before_blind_scout: config.limits.max_candidates,
    github_search_queries: sourcePlanV2.github_query_matrix.map((entry) => ({
      id: entry.id,
      description: `SourcePlan v2 ${entry.intent} query`,
      q: entry.q,
      sort: entry.sort,
      order: entry.order,
      page_start: 1 as const,
      page_limit: entry.page_limit,
      per_page: entry.per_page,
      enabled: entry.enabled
    })),
    rss_feeds: [],
    disabled_sources: []
  };
}

function pushedAfterFor(date: string) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCMonth(parsed.getUTCMonth() - 1, 1);
  return parsed.toISOString().slice(0, 10);
}

async function fixtureFallback(projectRoot: string): Promise<RuntimeCandidate[]> {
  try {
    const parsed = JSON.parse(await readFile(join(projectRoot, "data", "scout_pipeline.json"), "utf8")) as {
      leads?: Array<{ id?: string; repo?: string; title?: string; summary?: string; token_roi_estimate?: number; artifacts?: { local_thumb_path?: string } }>;
    };
    return (parsed.leads ?? []).map((lead, index) => ({
      id: lead.id ?? `fixture-${index}`,
      repo: lead.repo ?? `fixture/repo-${index}`,
      title: lead.title ?? `Fixture ${index}`,
      category: "advanced_ppt",
      readme: lead.summary ?? "",
      qualityScore: Math.round((lead.token_roi_estimate ?? 0.1) * 100),
      artifact_urls: lead.artifacts?.local_thumb_path ? [lead.artifacts.local_thumb_path] : []
    }));
  } catch {
    return [];
  }
}

async function fetchWithTimeout(input: CliRunInput, url: string, headers: Record<string, string>, timeoutMs: number) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await input.fetchImpl(url, {
      headers,
      signal: abortController.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

async function jsonRequest(input: CliRunInput, url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpJsonResult<unknown>> {
  const response = await fetchWithTimeout(input, url, headers, timeoutMs);
  const text = await response.text();
  return {
    status: response.status,
    headers: headersToRecord(response.headers),
    body: text ? JSON.parse(text) : {}
  };
}

async function textRequest(input: CliRunInput, url: string, headers: Record<string, string>, timeoutMs: number): Promise<HttpTextResult> {
  const response = await fetchWithTimeout(input, url, headers, timeoutMs);
  return {
    status: response.status,
    headers: headersToRecord(response.headers),
    body: await response.text()
  };
}

export async function runRuntimeOrchestratorCli(input: CliRunInput): Promise<RuntimeRunResult> {
  const config = parseRuntimeCliArgs(input.argv, input);
  const fallback = await fixtureFallback(config.paths.project_root);
  const logPath = join(config.paths.logs_dir, `sentinel_daily_${config.date}.log`);
  const liveSourceAdapter = createRealSourceAdapter(
    {
      version: 1,
      runtime: {
        date: config.date,
        run_id: config.run_id,
        gates: config.gates,
        paths: {
          run_shadow_dir: config.paths.run_shadow_dir
        },
        limits: config.limits
      },
      source_plan: defaultSourcePlan(config),
      github: {
        token_env: "GITHUB_TOKEN",
        api_version: "2026-03-10",
        user_agent: "project-sentinel-v3-local",
        request_timeout_ms: 8000,
        max_concurrency: 2,
        max_pages_per_query: 1,
        per_page: 20,
        max_readme_bytes: 50 * 1024,
        max_readme_digest_chars: 50 * 1024,
        max_secondary_limit_retries: 3
      }
    },
    {
      http: {
        getJson: (request) => jsonRequest(input, request.url, request.headers, request.timeout_ms),
        getText: (request) => textRequest(input, request.url, request.headers, request.timeout_ms)
      },
      fileStore: {
        writeJsonAtomic,
        writeTextAtomic
      },
      logger: {
        write: async (event) => {
          await mkdir(dirname(logPath), { recursive: true });
          await appendFile(logPath, `${JSON.stringify({ timestamp: input.now().toISOString(), ...event })}\n`, "utf8");
        }
      },
      fixtureFallback: fallback,
      blacklist: {
        repos: [],
        authors: []
      },
      sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
      now: input.now,
      env: input.env
    }
  );

  const result = await runRuntimeOrchestrator({
    config,
    adapters: {
      mockSource: {
        fetchCandidates: async () => fallback
      },
      liveSource: {
        fetchCandidates: async () => {
          const result = await liveSourceAdapter.fetchCandidates();
          return {
            candidates: result.candidates,
            shadow_evidence: result.shadow_evidence
          };
        }
      },
      mockModel: {
        invoke: async () => ({ provider: "mock" })
      },
      liveModel: {
        invoke: async () => {
          throw new Error("LIVE_MODEL_CLIENT_NOT_CONFIGURED");
        }
      },
      capturer: {
        captureLead: async (lead, context) => ({
          local_thumb_path: lead.artifact_urls[0] ?? join(context.shadowArtifactRoot, lead.repo.replaceAll("/", "_"), "thumb.svg"),
          status: lead.artifact_urls.length > 0 ? "CAPTURED" : "FALLBACK_USED",
          errors: []
        })
      },
      publisher: {
        atomicRename: async ({ from, to }) => {
          await mkdir(dirname(to), { recursive: true });
          await rename(from, to);
        },
        publish: async () => undefined
      },
      logger: {
        write: async (event) => {
          await mkdir(dirname(logPath), { recursive: true });
          await appendFile(logPath, `${JSON.stringify({ timestamp: input.now().toISOString(), ...event })}\n`, "utf8");
        }
      }
    },
    resume: true,
    staleLockTtlMs: 86_400_000,
    now: input.now
  });

  input.stdout(JSON.stringify({ status: result.status, run_id: result.run_id, routing: result.routing }));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRuntimeOrchestratorCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    now: () => new Date(),
    fetchImpl: fetch,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line)
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
