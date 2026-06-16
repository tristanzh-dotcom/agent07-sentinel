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

export async function scanArtifactHintGuard(_input: ArtifactHintGuardInput): Promise<ArtifactHintGuardResult> {
  throw new ArtifactHintGuardNotImplementedError("scanArtifactHintGuard");
}

export async function applyArtifactHintGuard(_input: ApplyArtifactHintGuardInput): Promise<ArtifactHintGuardResult> {
  throw new ArtifactHintGuardNotImplementedError("applyArtifactHintGuard");
}

