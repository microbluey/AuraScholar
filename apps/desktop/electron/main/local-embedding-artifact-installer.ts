import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { LocalEmbeddingArtifact, LocalEmbeddingModelSpec } from "./local-embedding-provider";
import {
  ArtifactIntegrityError,
  DEFAULT_LOCAL_EMBEDDING_ARTIFACT_QUOTA_BYTES,
  INSTALLATION_SCHEMA_VERSION,
  type ActiveInstallation,
  type InternalInspection,
  type LocalEmbeddingArtifactInstallPlan,
  type LocalEmbeddingArtifactInstallResult,
  type LocalEmbeddingArtifactInstallSession,
  type LocalEmbeddingArtifactInstallerOptions,
  type LocalEmbeddingArtifactStatus,
  type StoredInstallation,
} from "./local-embedding-artifact-types.js";
import {
  assertInside,
  assertManifestMatchesModel,
  assertModelIdentifier,
  canonicalManifestSha256,
  isRecord,
  manifestTotalBytes,
  normalizeInstallPlan,
  validTimestamp,
} from "./local-embedding-artifact-manifest.js";
import {
  artifactSummary,
  assertDirectory,
  corrupt,
  directoryState,
  localArtifact,
  pathExists,
  readStoredInstallation,
  removeArtifactDirectory,
  verifyInstalledArtifact,
  verifyStagedArtifact,
  writeStoredInstallation,
} from "./local-embedding-artifact-storage.js";

export { DEFAULT_LOCAL_EMBEDDING_ARTIFACT_QUOTA_BYTES } from "./local-embedding-artifact-types.js";
export type {
  LocalEmbeddingArtifactCorruptionReason,
  LocalEmbeddingArtifactFile,
  LocalEmbeddingArtifactInstallConsent,
  LocalEmbeddingArtifactInstallPlan,
  LocalEmbeddingArtifactInstallResult,
  LocalEmbeddingArtifactInstallSession,
  LocalEmbeddingArtifactInstallerOptions,
  LocalEmbeddingArtifactLicense,
  LocalEmbeddingArtifactManifest,
  LocalEmbeddingArtifactStatus,
  LocalEmbeddingInstalledArtifactSummary,
} from "./local-embedding-artifact-types.js";
export { canonicalLocalEmbeddingArtifactManifestSha256 } from "./local-embedding-artifact-manifest.js";

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
