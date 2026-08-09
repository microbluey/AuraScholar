import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { join } from "node:path";
import type { LocalEmbeddingArtifact } from "./local-embedding-provider";
import {
  ArtifactIntegrityError,
  INSTALLATION_SCHEMA_VERSION,
  MANIFEST_FILE,
  MAX_MANIFEST_BYTES,
  type InternalInspection,
  type LocalEmbeddingArtifactCorruptionReason,
  type LocalEmbeddingInstalledArtifactSummary,
  type NormalizedArtifactManifest,
  type StoredInstallation,
} from "./local-embedding-artifact-types.js";
import {
  artifactPath,
  canonicalManifestJson,
  isRecord,
  normalizeConsent,
  normalizeLicense,
  normalizeManifest,
  requireSha256,
  validTimestamp,
} from "./local-embedding-artifact-manifest.js";

export async function verifyStagedArtifact(
  artifactDirectory: string,
  manifest: NormalizedArtifactManifest,
  totalBytes: number,
): Promise<void> {
  await verifyArtifactFiles(artifactDirectory, manifest, totalBytes, false);
}

export async function verifyInstalledArtifact(
  artifactDirectory: string,
  manifest: NormalizedArtifactManifest,
  totalBytes: number,
): Promise<void> {
  await verifyArtifactFiles(artifactDirectory, manifest, totalBytes, true);
}

export async function verifyArtifactFiles(
  artifactDirectory: string,
  manifest: NormalizedArtifactManifest,
  totalBytes: number,
  allowStoredManifest: boolean,
): Promise<void> {
  const actualFiles = await listArtifactFiles(artifactDirectory, allowStoredManifest);
  const expectedPaths = new Set(manifest.files.map((file) => file.path));
  for (const actual of actualFiles) {
    if (!expectedPaths.has(actual.path)) throw new ArtifactIntegrityError("unexpected-entry");
  }
  if (actualFiles.length !== manifest.files.length)
    throw new ArtifactIntegrityError("missing-file");

  let verifiedBytes = 0;
  for (const expected of manifest.files) {
    const target = artifactPath(artifactDirectory, expected.path);
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new ArtifactIntegrityError("missing-file");
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ArtifactIntegrityError("unsafe-entry");
    if (stat.size !== expected.byteLength) throw new ArtifactIntegrityError("file-size-mismatch");
    const digest = await sha256File(target);
    if (digest !== expected.sha256) throw new ArtifactIntegrityError("file-hash-mismatch");
    verifiedBytes += stat.size;
  }
  if (verifiedBytes !== totalBytes) throw new ArtifactIntegrityError("file-size-mismatch");
}

export async function listArtifactFiles(
  root: string,
  allowStoredManifest: boolean,
): Promise<Array<{ path: string }>> {
  const rootStat = await fs.lstat(root).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT")
      throw new ArtifactIntegrityError("missing-file");
    throw error;
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ArtifactIntegrityError("unsafe-entry");
  }
  const files: Array<{ path: string }> = [];
  await visit(root, "");
  return files;

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = artifactPath(root, relativePath);
      if (entry.isSymbolicLink()) throw new ArtifactIntegrityError("unsafe-entry");
      if (entry.isDirectory()) {
        await visit(target, relativePath);
        continue;
      }
      if (!entry.isFile()) throw new ArtifactIntegrityError("unsafe-entry");
      if (relativePath === MANIFEST_FILE) {
        if (!allowStoredManifest) throw new ArtifactIntegrityError("unexpected-entry");
        continue;
      }
      files.push({ path: relativePath });
    }
  }
}

export async function writeStoredInstallation(
  artifactDirectory: string,
  installation: StoredInstallation,
): Promise<void> {
  const target = join(artifactDirectory, MANIFEST_FILE);
  const payload = JSON.stringify({
    consent: installation.consent,
    installedAt: installation.installedAt,
    license: installation.license,
    manifest: JSON.parse(canonicalManifestJson(installation.manifest)),
    manifestSha256: installation.manifestSha256,
    schemaVersion: installation.schemaVersion,
  });
  await fs.writeFile(target, payload, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function readStoredInstallation(
  artifactDirectory: string,
): Promise<StoredInstallation> {
  const target = join(artifactDirectory, MANIFEST_FILE);
  let raw: string;
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) {
      throw new ArtifactIntegrityError("manifest-invalid");
    }
    raw = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error instanceof ArtifactIntegrityError) throw error;
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ArtifactIntegrityError("manifest-missing");
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ArtifactIntegrityError("manifest-invalid");
  }
  try {
    if (!isRecord(parsed) || parsed.schemaVersion !== INSTALLATION_SCHEMA_VERSION) {
      throw new Error("invalid installation metadata");
    }
    const manifest = normalizeManifest(parsed.manifest);
    const manifestSha256 = requireSha256(parsed.manifestSha256, "Stored manifest digest");
    const license = normalizeLicense(parsed.license);
    const consent = normalizeConsent(parsed.consent, license.id);
    return {
      consent,
      installedAt: validTimestamp(parsed.installedAt, "Installation timestamp"),
      license,
      manifest,
      manifestSha256,
      schemaVersion: INSTALLATION_SCHEMA_VERSION,
    };
  } catch {
    throw new ArtifactIntegrityError("manifest-invalid");
  }
}

export function artifactSummary(
  installation: StoredInstallation,
  totalBytes: number,
): LocalEmbeddingInstalledArtifactSummary {
  return {
    artifactModelId: installation.manifest.artifactModelId,
    fileCount: installation.manifest.files.length,
    installedAt: installation.installedAt,
    manifestSha256: installation.manifestSha256,
    modelId: installation.manifest.modelId,
    modelRevision: installation.manifest.modelRevision,
    runtimeId: installation.manifest.runtimeId,
    runtimeVersion: installation.manifest.runtimeVersion,
    sourceModelId: installation.manifest.sourceModelId,
    totalBytes,
  };
}

export function localArtifact(
  targetDirectory: string,
  installation: StoredInstallation,
): LocalEmbeddingArtifact {
  return {
    manifestSha256: installation.manifestSha256,
    modelRevision: installation.manifest.modelRevision,
    rootDirectory: targetDirectory,
    runtimeId: installation.manifest.runtimeId,
    runtimeVersion: installation.manifest.runtimeVersion,
  };
}

export async function removeArtifactDirectory(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    await fs.unlink(target);
    return;
  }
  await fs.rm(target, { force: true, recursive: true });
}

export async function assertDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Local embedding artifact storage is unsafe");
  }
}

export async function directoryState(target: string): Promise<"directory" | "missing" | "other"> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "other";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "missing";
    throw error;
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function corrupt(reason: LocalEmbeddingArtifactCorruptionReason): InternalInspection {
  return { artifact: null, status: { reason, state: "corrupt" } };
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
