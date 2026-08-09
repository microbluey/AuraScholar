import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { LocalEmbeddingArtifact, LocalEmbeddingModelSpec } from "./local-embedding-provider";

const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_FILE = ".aurascholar-embedding-manifest.json";
const INSTALLATION_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;
const MAX_ARTIFACT_FILES = 4_096;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 1_024;
const MAX_TEXT_LENGTH = 512;
const MAX_MODEL_ID_LENGTH = 128;

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

interface NormalizedArtifactManifest {
  artifactModelId: string;
  files: LocalEmbeddingArtifactFile[];
  modelId: string;
  modelRevision: string;
  runtimeId: string;
  runtimeVersion: string;
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  sourceModelId: string;
}

interface NormalizedInstallationPlan {
  consent: LocalEmbeddingArtifactInstallConsent;
  license: LocalEmbeddingArtifactLicense;
  manifest: NormalizedArtifactManifest;
  manifestSha256: string;
  model: LocalEmbeddingModelSpec;
  totalBytes: number;
}

interface ActiveInstallation {
  artifactDirectory: string;
  plan: NormalizedInstallationPlan;
  stagingDirectory: string;
}

interface StoredInstallation {
  consent: LocalEmbeddingArtifactInstallConsent;
  installedAt: number;
  license: LocalEmbeddingArtifactLicense;
  manifest: NormalizedArtifactManifest;
  manifestSha256: string;
  schemaVersion: typeof INSTALLATION_SCHEMA_VERSION;
}

interface InternalInspection {
  artifact: LocalEmbeddingArtifact | null;
  status: LocalEmbeddingArtifactStatus;
}

class ArtifactIntegrityError extends Error {
  constructor(readonly reason: LocalEmbeddingArtifactCorruptionReason) {
    super(reason);
  }
}

/**
 * Owns the durable local-model directory. It never downloads a model and only
 * accepts a catalog-pinned plan plus a private staging capability created by
 * this instance. That prevents renderer-controlled paths, remote URLs, and
 * partially downloaded artifacts from becoming inference inputs.
 */
export class LocalEmbeddingArtifactInstaller {
  private readonly activeInstalls = new Map<string, ActiveInstallation>();
  private readonly maxArtifactBytes: number;
  private readonly now: () => number;
  private readonly rootDirectory: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: LocalEmbeddingArtifactInstallerOptions) {
    if (!isAbsolute(options.rootDirectory)) {
      throw new Error("Local embedding artifact root must be an absolute path");
    }
    const maxArtifactBytes =
      options.maxArtifactBytes ?? DEFAULT_LOCAL_EMBEDDING_ARTIFACT_QUOTA_BYTES;
    if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes <= 0) {
      throw new Error("Local embedding artifact quota must be a positive integer");
    }
    this.maxArtifactBytes = maxArtifactBytes;
    this.now = options.now ?? Date.now;
    this.rootDirectory = resolve(options.rootDirectory);
  }

  /**
   * Validates catalog identity and consent, then creates an empty private
   * staging directory. The caller must write exactly the manifest's files into
   * `session.artifactDirectory` and call completeInstall afterwards.
   */
  beginInstall(
    plan: LocalEmbeddingArtifactInstallPlan,
  ): Promise<LocalEmbeddingArtifactInstallSession> {
    return this.runExclusive(async () => {
      const normalizedPlan = normalizeInstallPlan(plan, this.maxArtifactBytes);
      await this.ensureStorageDirectories();
      const id = randomUUID();
      const stagingDirectory = join(this.stagingDirectory(), id);
      const artifactDirectory = join(stagingDirectory, "artifact");
      await fs.mkdir(artifactDirectory, { mode: 0o700, recursive: true });
      this.activeInstalls.set(id, { artifactDirectory, plan: normalizedPlan, stagingDirectory });
      return { artifactDirectory, id };
    });
  }

  /** Drops an incomplete private stage. It cannot remove any installed model. */
  abortInstall(session: LocalEmbeddingArtifactInstallSession): Promise<void> {
    return this.runExclusive(async () => {
      const active = this.requireActiveInstall(session);
      this.activeInstalls.delete(session.id);
      await fs.rm(active.stagingDirectory, { force: true, recursive: true });
    });
  }

  /**
   * Verifies every staged byte, writes durable metadata, then atomically swaps
   * the verified directory into place. If publication fails, it attempts to
   * restore the prior artifact and keeps this session abortable for cleanup.
   */
  completeInstall(
    session: LocalEmbeddingArtifactInstallSession,
  ): Promise<LocalEmbeddingArtifactInstallResult> {
    return this.runExclusive(async () => {
      const active = this.requireActiveInstall(session);
      const { manifest, totalBytes } = active.plan;
      await verifyStagedArtifact(active.artifactDirectory, manifest, totalBytes);
      const installedAt = validTimestamp(this.now(), "Installation timestamp");
      const stored: StoredInstallation = {
        consent: active.plan.consent,
        installedAt,
        license: active.plan.license,
        manifest,
        manifestSha256: active.plan.manifestSha256,
        schemaVersion: INSTALLATION_SCHEMA_VERSION,
      };
      await writeStoredInstallation(active.artifactDirectory, stored);

      const targetDirectory = this.installedArtifactDirectory(manifest.modelId);
      await this.publishArtifact(active, targetDirectory);
      this.activeInstalls.delete(session.id);
      // The publish is already durable; a stale empty stage is safe to clean on
      // a later attempt and must not turn a successful install into a failure.
      await fs.rm(active.stagingDirectory, { force: true, recursive: true }).catch(() => {});

      const summary = artifactSummary(stored, totalBytes);
      return {
        artifact: localArtifact(targetDirectory, stored),
        summary,
      };
    });
  }

  /** Inspects the selected model without exposing its local artifact path. */
  inspect(model: LocalEmbeddingModelSpec): Promise<LocalEmbeddingArtifactStatus> {
    return this.runExclusive(async () => (await this.inspectInternal(model)).status);
  }

  /** Main-process-only accessor for a fully re-verified runtime artifact. */
  getInstalledArtifact(model: LocalEmbeddingModelSpec): Promise<LocalEmbeddingArtifact | null> {
    return this.runExclusive(async () => (await this.inspectInternal(model)).artifact);
  }

  /**
   * Removes only the deterministic model target inside this installer's root.
   * Active stages for the same model are cancelled so an old download cannot
   * recreate the model after the user has asked to remove it.
   */
  uninstall(model: LocalEmbeddingModelSpec): Promise<{ removed: boolean }> {
    return this.runExclusive(async () => {
      assertModelIdentifier(model.id);
      await this.ensureStorageDirectories();
      const cancelled = [...this.activeInstalls.entries()].filter(
        ([, active]) => active.plan.manifest.modelId === model.id,
      );
      for (const [id, active] of cancelled) {
        this.activeInstalls.delete(id);
        await fs.rm(active.stagingDirectory, { force: true, recursive: true });
      }

      const targetDirectory = this.installedArtifactDirectory(model.id);
      const existed = await pathExists(targetDirectory);
      if (!existed) return { removed: false };
      await removeArtifactDirectory(targetDirectory);
      return { removed: true };
    });
  }

  private async inspectInternal(model: LocalEmbeddingModelSpec): Promise<InternalInspection> {
    try {
      assertModelIdentifier(model.id);
      const targetDirectory = this.installedArtifactDirectory(model.id);
      const state = await directoryState(targetDirectory);
      if (state === "missing") return { artifact: null, status: { state: "not-installed" } };
      if (state !== "directory") return corrupt("unsafe-entry");

      const stored = await readStoredInstallation(targetDirectory);
      assertManifestMatchesModel(stored.manifest, model);
      if (canonicalManifestSha256(stored.manifest) !== stored.manifestSha256) {
        throw new ArtifactIntegrityError("manifest-invalid");
      }
      const totalBytes = manifestTotalBytes(stored.manifest);
      if (totalBytes > this.maxArtifactBytes) throw new ArtifactIntegrityError("manifest-invalid");
      await verifyInstalledArtifact(targetDirectory, stored.manifest, totalBytes);
      return {
        artifact: localArtifact(targetDirectory, stored),
        status: { artifact: artifactSummary(stored, totalBytes), state: "ready" },
      };
    } catch (error) {
      if (error instanceof ArtifactIntegrityError) return corrupt(error.reason);
      return corrupt("unreadable");
    }
  }

  private async ensureStorageDirectories(): Promise<void> {
    await fs.mkdir(this.rootDirectory, { mode: 0o700, recursive: true });
    await assertDirectory(this.rootDirectory);
    for (const directory of [
      this.stagingDirectory(),
      this.installedDirectory(),
      this.replacedDirectory(),
    ]) {
      await fs.mkdir(directory, { mode: 0o700, recursive: true });
      await assertDirectory(directory);
    }
  }

  private async publishArtifact(
    active: ActiveInstallation,
    targetDirectory: string,
  ): Promise<void> {
    await this.ensureStorageDirectories();
    const backupDirectory = join(
      this.replacedDirectory(),
      `${active.plan.manifest.modelId}-${active.stagingDirectory.slice(-36)}`,
    );
    const hasExistingTarget = await pathExists(targetDirectory);
    if (hasExistingTarget) await fs.rename(targetDirectory, backupDirectory);

    try {
      await fs.rename(active.artifactDirectory, targetDirectory);
    } catch (error) {
      if (hasExistingTarget) {
        await fs.rename(backupDirectory, targetDirectory).catch(() => {});
      }
      throw error;
    }

    // A stale backup contains only an already-superseded verified artifact. Do
    // not report a successful atomic publish as failed merely because a virus
    // scanner or file indexer temporarily holds that old directory open.
    if (hasExistingTarget) {
      await fs.rm(backupDirectory, { force: true, recursive: true }).catch(() => {});
    }
  }

  private installedArtifactDirectory(modelId: string): string {
    assertModelIdentifier(modelId);
    const target = join(this.installedDirectory(), modelId);
    assertInside(this.installedDirectory(), target, "Local embedding artifact path");
    return target;
  }

  private installedDirectory(): string {
    return join(this.rootDirectory, "installed");
  }

  private replacedDirectory(): string {
    return join(this.rootDirectory, "replaced");
  }

  private stagingDirectory(): string {
    return join(this.rootDirectory, "staging");
  }

  private requireActiveInstall(session: LocalEmbeddingArtifactInstallSession): ActiveInstallation {
    if (
      !isRecord(session) ||
      typeof session.id !== "string" ||
      typeof session.artifactDirectory !== "string"
    ) {
      throw new Error("Unknown local embedding installation session");
    }
    const active = this.activeInstalls.get(session.id);
    if (!active || active.artifactDirectory !== session.artifactDirectory) {
      throw new Error("Unknown local embedding installation session");
    }
    return active;
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** Produces the exact digest a trusted model catalog must pin. */
export function canonicalLocalEmbeddingArtifactManifestSha256(
  manifest: LocalEmbeddingArtifactManifest,
): string {
  return canonicalManifestSha256(normalizeManifest(manifest));
}

function normalizeInstallPlan(
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

function normalizeManifest(value: unknown): NormalizedArtifactManifest {
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

function normalizeManifestFile(value: unknown): LocalEmbeddingArtifactFile {
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
function compareArtifactPaths(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeModel(value: unknown): LocalEmbeddingModelSpec {
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

function normalizeLicense(value: unknown): LocalEmbeddingArtifactLicense {
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

function normalizeConsent(
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

function assertManifestMatchesModel(
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

function canonicalManifestSha256(manifest: NormalizedArtifactManifest): string {
  return sha256Text(canonicalManifestJson(manifest));
}

function canonicalManifestJson(manifest: NormalizedArtifactManifest): string {
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

function manifestTotalBytes(manifest: Pick<NormalizedArtifactManifest, "files">): number {
  const total = manifest.files.reduce((sum, file) => sum + file.byteLength, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new ArtifactIntegrityError("manifest-invalid");
  }
  return total;
}

async function verifyStagedArtifact(
  artifactDirectory: string,
  manifest: NormalizedArtifactManifest,
  totalBytes: number,
): Promise<void> {
  await verifyArtifactFiles(artifactDirectory, manifest, totalBytes, false);
}

async function verifyInstalledArtifact(
  artifactDirectory: string,
  manifest: NormalizedArtifactManifest,
  totalBytes: number,
): Promise<void> {
  await verifyArtifactFiles(artifactDirectory, manifest, totalBytes, true);
}

async function verifyArtifactFiles(
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

async function listArtifactFiles(
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

async function writeStoredInstallation(
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

async function readStoredInstallation(artifactDirectory: string): Promise<StoredInstallation> {
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

function artifactSummary(
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

function localArtifact(
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

async function removeArtifactDirectory(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    await fs.unlink(target);
    return;
  }
  await fs.rm(target, { force: true, recursive: true });
}

async function assertDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Local embedding artifact storage is unsafe");
  }
}

async function directoryState(target: string): Promise<"directory" | "missing" | "other"> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "other";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "missing";
    throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function artifactPath(root: string, artifactRelativePath: string): string {
  const target = join(root, ...artifactRelativePath.split("/"));
  assertInside(root, target, "Local embedding artifact file path");
  return target;
}

function assertInside(root: string, target: string, label: string): void {
  const relation = relative(resolve(root), resolve(target));
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} escapes its storage root`);
  }
}

function requireRelativeArtifactPath(value: unknown): string {
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

function assertModelIdentifier(value: string): void {
  requireModelId(value);
}

function requireModelId(value: unknown): string {
  const modelId = requireText(value, "Local embedding model id", MAX_MODEL_ID_LENGTH);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(modelId)) {
    throw new Error("Local embedding model id is invalid");
  }
  return modelId;
}

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes("\u0000")) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validTimestamp(value: unknown, label: string): number {
  return requirePositiveInteger(value, label);
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function corrupt(reason: LocalEmbeddingArtifactCorruptionReason): InternalInspection {
  return { artifact: null, status: { reason, state: "corrupt" } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
