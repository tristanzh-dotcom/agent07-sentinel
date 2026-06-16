export class ArtifactHintGuardNotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`);
    this.name = "ArtifactHintGuardNotImplementedError";
  }
}

export type ArtifactHintGuardStatus = "PASS" | "LOW_QUALITY_FILTERED";

export type ArtifactGuardReasonCode =
  | "ZIP_DOWNLOAD_DOMINATED"
  | "LOCAL_INSTALL_POLLUTION"
  | "NO_ARCHITECTURE_SIGNAL"
  | "NO_TEST_OR_EXAMPLE_SIGNAL"
  | "NO_VISUAL_ARTIFACT_SIGNAL"
  | "ARCHIVE_AS_PRIMARY_ARTIFACT"
  | "PROMPT_WRAPPER_LANGUAGE"
  | "REGEX_SCAN_TIMEOUT"
  | "PASS_HIGH_TRUST_ARCHITECTURE"
  | "PASS_VISUAL_EXAMPLES"
  | "PASS_TESTS_AND_DOCS";

export type ArtifactHintGuardResult = {
  status: ArtifactHintGuardStatus;
  roi_multiplier: number;
  trust_score: number;
  positive_fingerprints: string[];
  negative_fingerprints: string[];
  checkpoint_marker?: "LOW_QUALITY_FILTERED";
  reason_codes: ArtifactGuardReasonCode[];
};

export type ArtifactHintGuardLogger = {
  write: (event: {
    level: "DEBUG" | "INFO" | "WARN" | "ERROR";
    component: string;
    event: string;
    meta: Record<string, unknown>;
  }) => Promise<void> | void;
};

export type ArtifactHintGuardInput = {
  repo: string;
  readme: string;
  artifactUrls: string[];
  queryIntent?: string;
  maxScanMs: number;
  now: () => Date;
  logger: ArtifactHintGuardLogger;
  scanner?: (input: { readme: string; artifactUrls: string[] }) => Promise<ArtifactHintGuardResult> | ArtifactHintGuardResult;
};

export type ArtifactGuardDownstream = {
  blindScout: (repo: string) => Promise<void> | void;
  capturer: (repo: string) => Promise<void> | void;
  auditor: (repo: string) => Promise<void> | void;
};

export type ApplyArtifactHintGuardInput = ArtifactHintGuardInput & {
  writeEnvelopeEvidence: (repo: string, result: ArtifactHintGuardResult) => Promise<void> | void;
  downstream: ArtifactGuardDownstream;
};

const archiveSuffixes = [".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".dmg", ".pkg", ".msi"];

const zipDownloadPhrases = [
  "download zip manually",
  "download the zip",
  "download package",
  "extract files",
  "double-click the file",
  "run the application",
  "visit the releases page to download",
  "raw/refs/heads/"
];

const localPollutionPhrases = [
  "place in root folder",
  "copy to c:\\",
  "extract to c:\\",
  "run as administrator",
  "disable antivirus",
  "chmod 777",
  "sudo curl",
  "curl ",
  "| sh"
];

const promptWrapperPhrases = [
  "generate slides with a prompt",
  "ai decides placement",
  "prompt determines position",
  "just describe your desired layout",
  "no code required"
];

const architecturePhrases = [
  "layout engine",
  "constraint solver",
  "constraint layout",
  "relative coordinate",
  "relative layout",
  "rendering pipeline",
  "architecture",
  "vector renderer",
  "typesetting engine",
  "flow layout"
];

const testOrExamplePhrases = [
  "test/",
  "tests/",
  "vitest",
  "jest",
  "pytest",
  "example",
  "examples/",
  "demo",
  "sample",
  "installation"
];

const visualArtifactPhrases = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".pdf", "screenshot", "gallery", "artifact"];

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function isArchiveArtifact(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return archiveSuffixes.some((suffix) => lowerUrl.includes(suffix)) || lowerUrl.includes("raw/refs/heads/") && lowerUrl.includes(".zip");
}

function uniqueReasonCodes(reasonCodes: ArtifactGuardReasonCode[]): ArtifactGuardReasonCode[] {
  return [...new Set(reasonCodes)];
}

function lowQualityResult(
  reasonCodes: ArtifactGuardReasonCode[],
  negativeFingerprints: string[],
  positiveFingerprints: string[] = [],
  trustScore = 0
): ArtifactHintGuardResult {
  return {
    status: "LOW_QUALITY_FILTERED",
    roi_multiplier: 0,
    trust_score: Math.max(0, Math.min(100, trustScore)),
    positive_fingerprints: positiveFingerprints,
    negative_fingerprints: negativeFingerprints,
    checkpoint_marker: "LOW_QUALITY_FILTERED",
    reason_codes: uniqueReasonCodes(reasonCodes)
  };
}

function passResult(reasonCodes: ArtifactGuardReasonCode[], positiveFingerprints: string[], trustScore: number): ArtifactHintGuardResult {
  return {
    status: "PASS",
    roi_multiplier: 1,
    trust_score: Math.max(0, Math.min(100, trustScore)),
    positive_fingerprints: positiveFingerprints,
    negative_fingerprints: [],
    reason_codes: uniqueReasonCodes(reasonCodes)
  };
}

function scanArtifactHintsLinearly(input: { readme: string; artifactUrls: string[]; queryIntent?: string }): ArtifactHintGuardResult {
  const text = input.readme.slice(0, 50 * 1024).toLowerCase();
  const artifactUrls = input.artifactUrls.map((url) => url.toLowerCase());
  const archiveCount = artifactUrls.filter(isArchiveArtifact).length;
  const archiveDominated = artifactUrls.length > 0 && archiveCount / artifactUrls.length > 0.5;
  const archiveAsPrimaryArtifact = artifactUrls.length > 0 && isArchiveArtifact(artifactUrls[0]);

  const hasZipDownloadLanguage = hasAny(text, zipDownloadPhrases);
  const hasLocalPollution = hasAny(text, localPollutionPhrases) && (text.includes("sudo curl") || text.includes("| sh") || text.includes("c:\\") || text.includes("root folder") || text.includes("administrator") || text.includes("antivirus"));
  const hasPromptWrapper = hasAny(text, promptWrapperPhrases);
  const hasArchitectureSignal = hasAny(text, architecturePhrases);
  const hasTestOrExampleSignal = hasAny(text, testOrExamplePhrases);
  const hasVisualArtifactSignal = hasAny(text, visualArtifactPhrases) || artifactUrls.some((url) => hasAny(url, visualArtifactPhrases));

  const reasonCodes: ArtifactGuardReasonCode[] = [];
  const positiveFingerprints: string[] = [];
  const negativeFingerprints: string[] = [];

  if (archiveDominated || hasZipDownloadLanguage && archiveCount > 0) {
    reasonCodes.push("ZIP_DOWNLOAD_DOMINATED");
    negativeFingerprints.push("archive_artifact_dominance");
  }

  if (archiveAsPrimaryArtifact) {
    reasonCodes.push("ARCHIVE_AS_PRIMARY_ARTIFACT");
    negativeFingerprints.push("archive_primary_artifact");
  }

  if (hasLocalPollution) {
    reasonCodes.push("LOCAL_INSTALL_POLLUTION");
    negativeFingerprints.push("local_environment_pollution");
  }

  if (hasPromptWrapper) {
    reasonCodes.push("PROMPT_WRAPPER_LANGUAGE");
    negativeFingerprints.push("prompt_positioning_wrapper");
  }

  if (hasArchitectureSignal) {
    reasonCodes.push("PASS_HIGH_TRUST_ARCHITECTURE");
    positiveFingerprints.push("architecture_signal");
  } else {
    reasonCodes.push("NO_ARCHITECTURE_SIGNAL");
    negativeFingerprints.push("missing_architecture_signal");
  }

  if (hasTestOrExampleSignal) {
    reasonCodes.push("PASS_TESTS_AND_DOCS");
    positiveFingerprints.push("test_or_example_signal");
  } else {
    reasonCodes.push("NO_TEST_OR_EXAMPLE_SIGNAL");
    negativeFingerprints.push("missing_test_or_example_signal");
  }

  if (hasVisualArtifactSignal) {
    reasonCodes.push("PASS_VISUAL_EXAMPLES");
    positiveFingerprints.push("visual_artifact_signal");
  } else {
    reasonCodes.push("NO_VISUAL_ARTIFACT_SIGNAL");
    negativeFingerprints.push("missing_visual_artifact_signal");
  }

  let trustScore = 10;
  if (hasArchitectureSignal) trustScore += 35;
  if (hasTestOrExampleSignal) trustScore += 25;
  if (hasVisualArtifactSignal) trustScore += 20;
  if (input.queryIntent) trustScore += 10;
  if (archiveDominated) trustScore -= 55;
  if (archiveAsPrimaryArtifact) trustScore -= 30;
  if (hasLocalPollution) trustScore -= 100;
  if (hasPromptWrapper) trustScore -= 35;
  if (!hasArchitectureSignal) trustScore -= 25;
  if (!hasTestOrExampleSignal) trustScore -= 20;
  if (!hasVisualArtifactSignal) trustScore -= 15;

  const hardFiltered =
    reasonCodes.includes("ZIP_DOWNLOAD_DOMINATED") ||
    reasonCodes.includes("LOCAL_INSTALL_POLLUTION") ||
    hasPromptWrapper ||
    !hasArchitectureSignal ||
    !hasTestOrExampleSignal ||
    trustScore < 45;

  if (hardFiltered) {
    return lowQualityResult(reasonCodes, negativeFingerprints, positiveFingerprints, trustScore);
  }

  return passResult(reasonCodes, positiveFingerprints, trustScore);
}

function timeoutResult(): ArtifactHintGuardResult {
  return lowQualityResult(["REGEX_SCAN_TIMEOUT"], ["scan_timeout"], [], 0);
}

export async function scanArtifactHintGuard(input: ArtifactHintGuardInput): Promise<ArtifactHintGuardResult> {
  const scanner =
    input.scanner ??
    ((scannerInput: { readme: string; artifactUrls: string[] }) =>
      scanArtifactHintsLinearly({
        readme: scannerInput.readme,
        artifactUrls: scannerInput.artifactUrls,
        queryIntent: input.queryIntent
      }));

  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<ArtifactHintGuardResult>((resolve) => {
    timeoutId = setTimeout(() => resolve(timeoutResult()), input.maxScanMs);
  });

  const result = await Promise.race([Promise.resolve(scanner({ readme: input.readme, artifactUrls: input.artifactUrls })), timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (result.reason_codes.includes("REGEX_SCAN_TIMEOUT")) {
    await input.logger.write({
      level: "WARN",
      component: "artifactHintGuard",
      event: "artifact_guard_scan_timeout",
      meta: {
        repo: input.repo,
        max_scan_ms: input.maxScanMs,
        timestamp: input.now().toISOString()
      }
    });
  }

  return result;
}

export async function applyArtifactHintGuard(input: ApplyArtifactHintGuardInput): Promise<ArtifactHintGuardResult> {
  const result = await scanArtifactHintGuard(input);

  if (result.status === "LOW_QUALITY_FILTERED") {
    await input.writeEnvelopeEvidence(input.repo, result);
    return result;
  }

  await input.downstream.blindScout(input.repo);
  await input.downstream.capturer(input.repo);
  await input.downstream.auditor(input.repo);
  return result;
}
