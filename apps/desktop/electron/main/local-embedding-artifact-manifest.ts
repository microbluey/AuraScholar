import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalEmbeddingModelSpec } from "./local-embedding-provider";
import {
  ArtifactIntegrityError,
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  MAX_ARTIFACT_FILES,
  MAX_MODEL_ID_LENGTH,
  MAX_RELATIVE_PATH_LENGTH,
  MAX_TEXT_LENGTH,
  SHA256,
  type LocalEmbeddingArtifactFile,
  type LocalEmbeddingArtifactInstallConsent,
  type LocalEmbeddingArtifactInstallPlan,
  type LocalEmbeddingArtifactLicense,
  type LocalEmbeddingArtifactManifest,
  type NormalizedArtifactManifest,
  type NormalizedInstallationPlan,
} from "./local-embedding-artifact-types.js";

/** Produces the exact digest a trusted model catalog must pin. */
export function canonicalLocalEmbeddingArtifactManifestSha256(
  manifest: LocalEmbeddingArtifactManifest,
): string {
  return canonicalManifestSha256(normalizeManifest(manifest));
}

export function normalizeInstallPlan(
  value: LocalEmbeddingArtifactInstallPlan,
  maxArtifactBytes: number,
): NormalizedInstallationPlan {
  if (!isRecord(value)) throw new Error("Local embedding installation plan is invalid");
  const model = normalizeModel(value.model);
  const manifest = normalizeManifest(value.manifest);
  assertManifestMatchesModel(manifest, model);
  const manifestSha256 = requireSha256(value.manifestSha256, "Local embedding manifest digest");
  if (canonicalManifestSha256(manifest) !== manifestSha256) {
    throw new Error("Local embedding manifest does not match its pinned digest");
  }
  const totalBytes = manifestTotalBytes(manifest);
  if (totalBytes > maxArtifactBytes) {
    throw new Error("Local embedding artifact exceeds the configured disk quota");
  }
  const license = normalizeLicense(value.license);
  const consent = normalizeConsent(value.consent, license.id);
  return { consent, license, manifest, manifestSha256, model, totalBytes };
}

export function normalizeManifest(value: unknown): NormalizedArtifactManifest {
  if (!isRecord(value)) throw new Error("Local embedding artifact manifest is invalid");
  if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error("Unsupported local embedding artifact manifest version");
  }
  const filesValue = value.files;
  if (
    !Array.isArray(filesValue) ||
    filesValue.length === 0 ||
    filesValue.length > MAX_ARTIFACT_FILES
  ) {
    throw new Error("Local embedding artifact manifest has an invalid file count");
  }
  const files = filesValue
    .map(normalizeManifestFile)
    .sort((left, right) => compareArtifactPaths(left.path, right.path));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1]!.path === files[index]!.path) {
      throw new Error("Local embedding artifact manifest has duplicate file paths");
    }
  }
  return {
    artifactModelId: requireText(value.artifactModelId, "Artifact model id", MAX_TEXT_LENGTH),
    files,
    modelId: requireModelId(value.modelId),
    modelRevision: requireText(value.modelRevision, "Model revision", MAX_TEXT_LENGTH),
    runtimeId: requireText(value.runtimeId, "Runtime id", MAX_TEXT_LENGTH),
    runtimeVersion: requireText(value.runtimeVersion, "Runtime version", MAX_TEXT_LENGTH),
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sourceModelId: requireText(value.sourceModelId, "Source model id", MAX_TEXT_LENGTH),
  };
}

export function normalizeManifestFile(value: unknown): LocalEmbeddingArtifactFile {
  if (!isRecord(value)) throw new Error("Local embedding artifact manifest file is invalid");
  return {
    byteLength: requirePositiveInteger(value.byteLength, "Local embedding artifact file size"),
    path: requireRelativeArtifactPath(value.path),
    sha256: requireSha256(value.sha256, "Local embedding artifact file digest"),
  };
}

/**
 * Canonical manifest bytes must not depend on the host locale. JavaScript's
 * string relational comparison is a deterministic UTF-16 code-unit order,
 * unlike localeCompare which can place punctuation differently per system.
 */
export function compareArtifactPaths(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function normalizeModel(value: unknown): LocalEmbeddingModelSpec {
  if (!isRecord(value)) throw new Error("Local embedding model specification is invalid");
  const maxSequenceTokens = requirePositiveInteger(
    value.maxSequenceTokens,
    "Local embedding max sequence tokens",
  );
  const maxContentTokens = requirePositiveInteger(
    value.maxContentTokens,
    "Local embedding max content tokens",
  );
  const documentWindowOverlapTokens = requireNonNegativeInteger(
    value.documentWindowOverlapTokens,
    "Local embedding document window overlap",
  );
  const dimension = requirePositiveInteger(value.dimension, "Local embedding dimension");
  if (
    maxContentTokens >= maxSequenceTokens ||
    documentWindowOverlapTokens >= maxContentTokens ||
    value.pooling !== "mean-l2-v1"
  ) {
    throw new Error("Local embedding model specification is invalid");
  }
  return {
    artifactModelId: requireText(value.artifactModelId, "Artifact model id", MAX_TEXT_LENGTH),
    dimension,
    documentPrefix: requireText(value.documentPrefix, "Document prefix", 64),
    documentWindowOverlapTokens,
    id: requireModelId(value.id),
    maxContentTokens,
    maxSequenceTokens,
    pooling: "mean-l2-v1",
    queryPrefix: requireText(value.queryPrefix, "Query prefix", 64),
    sourceModelId: requireText(value.sourceModelId, "Source model id", MAX_TEXT_LENGTH),
  };
}

export function normalizeLicense(value: unknown): LocalEmbeddingArtifactLicense {
  if (!isRecord(value)) throw new Error("Local embedding artifact license is invalid");
  const url = value.url;
  if (
    url !== undefined &&
    (typeof url !== "string" || url.trim().length === 0 || url.length > 2_048)
  ) {
    throw new Error("Local embedding artifact license URL is invalid");
  }
  return {
    id: requireText(value.id, "Local embedding artifact license id", MAX_TEXT_LENGTH),
    label: requireText(value.label, "Local embedding artifact license label", MAX_TEXT_LENGTH),
    ...(url === undefined ? {} : { url: url.trim() }),
  };
}

export function normalizeConsent(
  value: unknown,
  expectedLicenseId: string,
): LocalEmbeddingArtifactInstallConsent {
  if (!isRecord(value)) throw new Error("Local embedding artifact consent is invalid");
  const acceptedLicenseId = requireText(
    value.acceptedLicenseId,
    "Accepted local embedding artifact license id",
    MAX_TEXT_LENGTH,
  );
  if (acceptedLicenseId !== expectedLicenseId) {
    throw new Error("Local embedding artifact consent does not match the displayed license");
  }
  const acceptedLicenseAt = validTimestamp(value.acceptedLicenseAt, "License acceptance timestamp");
  const approvedDownloadAt = validTimestamp(
    value.approvedDownloadAt,
    "Download approval timestamp",
  );
  if (approvedDownloadAt < acceptedLicenseAt) {
    throw new Error("Local embedding artifact download approval predates license acceptance");
  }
  return { acceptedLicenseAt, acceptedLicenseId, approvedDownloadAt };
}

export function assertManifestMatchesModel(
  manifest: Pick<NormalizedArtifactManifest, "artifactModelId" | "modelId" | "sourceModelId">,
  model: LocalEmbeddingModelSpec,
): void {
  if (
    manifest.modelId !== model.id ||
    manifest.artifactModelId !== model.artifactModelId ||
    manifest.sourceModelId !== model.sourceModelId
  ) {
    throw new ArtifactIntegrityError("model-mismatch");
  }
}

export function canonicalManifestSha256(manifest: NormalizedArtifactManifest): string {
  return sha256Text(canonicalManifestJson(manifest));
}

export function canonicalManifestJson(manifest: NormalizedArtifactManifest): string {
  return JSON.stringify({
    artifactModelId: manifest.artifactModelId,
    files: manifest.files.map((file) => ({
      byteLength: file.byteLength,
      path: file.path,
      sha256: file.sha256,
    })),
    modelId: manifest.modelId,
    modelRevision: manifest.modelRevision,
    runtimeId: manifest.runtimeId,
    runtimeVersion: manifest.runtimeVersion,
    schemaVersion: manifest.schemaVersion,
    sourceModelId: manifest.sourceModelId,
  });
}

export function manifestTotalBytes(manifest: Pick<NormalizedArtifactManifest, "files">): number {
  const total = manifest.files.reduce((sum, file) => sum + file.byteLength, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new ArtifactIntegrityError("manifest-invalid");
  }
  return total;
}

export function artifactPath(root: string, artifactRelativePath: string): string {
  const target = join(root, ...artifactRelativePath.split("/"));
  assertInside(root, target, "Local embedding artifact file path");
  return target;
}

export function assertInside(root: string, target: string, label: string): void {
  const relation = relative(resolve(root), resolve(target));
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} escapes its storage root`);
  }
}

export function requireRelativeArtifactPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new Error("Local embedding artifact file path is invalid");
  }
  if (value.includes("\\\\") || value.startsWith("/") || value.includes("\u0000")) {
    throw new Error("Local embedding artifact file path is invalid");
  }
  const segments = value.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    value === MANIFEST_FILE
  ) {
    throw new Error("Local embedding artifact file path is invalid");
  }
  return value;
}

export function assertModelIdentifier(value: string): void {
  requireModelId(value);
}

export function requireModelId(value: unknown): string {
  const modelId = requireText(value, "Local embedding model id", MAX_MODEL_ID_LENGTH);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(modelId)) {
    throw new Error("Local embedding model id is invalid");
  }
  return modelId;
}

export function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes("\u0000")) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export function validTimestamp(value: unknown, label: string): number {
  return requirePositiveInteger(value, label);
}

export function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
