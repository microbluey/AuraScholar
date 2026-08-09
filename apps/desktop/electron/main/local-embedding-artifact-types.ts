import type { LocalEmbeddingArtifact, LocalEmbeddingModelSpec } from "./local-embedding-provider";

export const SHA256 = /^[a-f0-9]{64}$/;
export const MANIFEST_FILE = ".aurascholar-embedding-manifest.json";
export const INSTALLATION_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_ARTIFACT_FILES = 4_096;
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MAX_RELATIVE_PATH_LENGTH = 1_024;
export const MAX_TEXT_LENGTH = 512;
export const MAX_MODEL_ID_LENGTH = 128;

/**
 * The artifact payload is deliberately capped separately from vector-index
 * storage. A future product setting can lower this, but callers cannot bypass
 * the ceiling supplied to the trusted main-process installer.
 */
export const DEFAULT_LOCAL_EMBEDDING_ARTIFACT_QUOTA_BYTES = 1024 * 1024 * 1024;

export interface LocalEmbeddingArtifactFile {
  readonly byteLength: number;
  /** POSIX-style path relative to the installed artifact root. */
  readonly path: string;
  readonly sha256: string;
}

/**
 * Download metadata pinned by a trusted catalog. Its digest is verified before
 * a downloader is allowed to populate the staging directory, then every file
 * is checked again before the artifact becomes visible to a runtime.
 */
export interface LocalEmbeddingArtifactManifest {
  readonly artifactModelId: string;
  readonly files: readonly LocalEmbeddingArtifactFile[];
  readonly modelId: string;
  readonly modelRevision: string;
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly sourceModelId: string;
}

export interface LocalEmbeddingArtifactLicense {
  readonly id: string;
  readonly label: string;
  readonly url?: string;
}

/**
 * This is recorded with an installed model rather than inferred from a later
 * setting. The renderer must display the license and collect these explicit
 * approvals before a future downloader asks the installer for a stage.
 */
export interface LocalEmbeddingArtifactInstallConsent {
  readonly acceptedLicenseAt: number;
  readonly acceptedLicenseId: string;
  readonly approvedDownloadAt: number;
}

export interface LocalEmbeddingArtifactInstallPlan {
  readonly consent: LocalEmbeddingArtifactInstallConsent;
  readonly license: LocalEmbeddingArtifactLicense;
  readonly manifest: LocalEmbeddingArtifactManifest;
  /** SHA-256 of the canonical manifest, supplied by the trusted catalog. */
  readonly manifestSha256: string;
  readonly model: LocalEmbeddingModelSpec;
}

/** Main-process-only capability handed to a downloader after consent. */
export interface LocalEmbeddingArtifactInstallSession {
  /** Absolute path; never pass this capability through renderer IPC. */
  readonly artifactDirectory: string;
  readonly id: string;
}

export interface LocalEmbeddingInstalledArtifactSummary {
  readonly artifactModelId: string;
  readonly fileCount: number;
  readonly installedAt: number;
  readonly manifestSha256: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly sourceModelId: string;
  readonly totalBytes: number;
}

export type LocalEmbeddingArtifactCorruptionReason =
  | "file-hash-mismatch"
  | "file-size-mismatch"
  | "manifest-invalid"
  | "manifest-missing"
  | "missing-file"
  | "model-mismatch"
  | "unexpected-entry"
  | "unreadable"
  | "unsafe-entry";

/** Safe to send to the renderer: it intentionally contains no local path. */
export type LocalEmbeddingArtifactStatus =
  | { readonly state: "not-installed" }
  | { readonly artifact: LocalEmbeddingInstalledArtifactSummary; readonly state: "ready" }
  | { readonly reason: LocalEmbeddingArtifactCorruptionReason; readonly state: "corrupt" };

export interface LocalEmbeddingArtifactInstallResult {
  readonly artifact: LocalEmbeddingArtifact;
  readonly summary: LocalEmbeddingInstalledArtifactSummary;
}

export interface LocalEmbeddingArtifactInstallerOptions {
  readonly maxArtifactBytes?: number;
  readonly now?: () => number;
  /** Main-process-only absolute root, normally userData/models/embedding. */
  readonly rootDirectory: string;
}

export interface NormalizedArtifactManifest {
  artifactModelId: string;
  files: LocalEmbeddingArtifactFile[];
  modelId: string;
  modelRevision: string;
  runtimeId: string;
  runtimeVersion: string;
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  sourceModelId: string;
}

export interface NormalizedInstallationPlan {
  consent: LocalEmbeddingArtifactInstallConsent;
  license: LocalEmbeddingArtifactLicense;
  manifest: NormalizedArtifactManifest;
  manifestSha256: string;
  model: LocalEmbeddingModelSpec;
  totalBytes: number;
}

export interface ActiveInstallation {
  artifactDirectory: string;
  plan: NormalizedInstallationPlan;
  stagingDirectory: string;
}

export interface StoredInstallation {
  consent: LocalEmbeddingArtifactInstallConsent;
  installedAt: number;
  license: LocalEmbeddingArtifactLicense;
  manifest: NormalizedArtifactManifest;
  manifestSha256: string;
  schemaVersion: typeof INSTALLATION_SCHEMA_VERSION;
}

export interface InternalInspection {
  artifact: LocalEmbeddingArtifact | null;
  status: LocalEmbeddingArtifactStatus;
}

export class ArtifactIntegrityError extends Error {
  constructor(readonly reason: LocalEmbeddingArtifactCorruptionReason) {
    super(reason);
  }
}
