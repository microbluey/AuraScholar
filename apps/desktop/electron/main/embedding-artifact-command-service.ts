import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import type {
  LocalEmbeddingArtifactCatalog,
  LocalEmbeddingArtifactCatalogStatus,
} from "./local-embedding-artifact-catalog";
import {
  downloadAndInstallLocalEmbeddingArtifact,
  type HuggingFaceArtifactSource,
} from "./local-embedding-artifact-downloader";
import type {
  LocalEmbeddingArtifactInstallPlan,
  LocalEmbeddingArtifactInstaller,
  LocalEmbeddingArtifactStatus,
} from "./local-embedding-artifact-installer";

const selectedModel = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;

export interface RemoveLocalEmbeddingArtifactResult {
  readonly removed: boolean;
  readonly status: LocalEmbeddingArtifactStatus;
}

/** Safe result of a fixed, catalog-controlled installation request. */
export interface InstallLocalEmbeddingArtifactResult {
  readonly alreadyInstalled: boolean;
  readonly status: LocalEmbeddingArtifactStatus;
}

/**
 * A command service never accepts a path, URL, manifest, or model identifier
 * from the renderer. This private request is assembled solely from the trusted
 * catalog after explicit UI consent.
 */
export interface EmbeddingArtifactDownloadRequest {
  readonly installer: Pick<
    LocalEmbeddingArtifactInstaller,
    "abortInstall" | "beginInstall" | "completeInstall"
  >;
  readonly plan: LocalEmbeddingArtifactInstallPlan;
  readonly source: HuggingFaceArtifactSource;
}

export interface EmbeddingArtifactCommandDependencies {
  downloadArtifact(request: EmbeddingArtifactDownloadRequest): Promise<void>;
  getArtifactCatalog(): Pick<LocalEmbeddingArtifactCatalog, "createDownloadRequest" | "getStatus">;
  getInstaller(): LocalEmbeddingArtifactInstaller;
  now(): number;
}

const activeInstallations = new WeakMap<
  EmbeddingArtifactCommandDependencies,
  Promise<InstallLocalEmbeddingArtifactResult>
>();

/**
 * Command logic separated from Electron wiring so it can be tested without an
 * Electron binary. The fixed model selection also means the renderer cannot
 * turn this into an arbitrary local-path inspection or deletion primitive.
 */
export async function getEmbeddingArtifactStatus(
  dependencies: EmbeddingArtifactCommandDependencies,
): Promise<LocalEmbeddingArtifactStatus> {
  return dependencies.getInstaller().inspect(selectedModel);
}

/** Safe catalog metadata only; it contains no file path, full manifest, or URL input. */
export async function getEmbeddingArtifactCatalogStatus(
  dependencies: EmbeddingArtifactCommandDependencies,
): Promise<LocalEmbeddingArtifactCatalogStatus> {
  return dependencies.getArtifactCatalog().getStatus();
}

export async function removeEmbeddingArtifact(
  dependencies: EmbeddingArtifactCommandDependencies,
): Promise<RemoveLocalEmbeddingArtifactResult> {
  const installer = dependencies.getInstaller();
  const { removed } = await installer.uninstall(selectedModel);
  return { removed, status: await installer.inspect(selectedModel) };
}

/**
 * Starts at most one installation per command-service dependency set. The IPC
 * has no arguments: the selected model, manifest, source URL components, and
 * consent timestamps are all selected in the trusted main process.
 */
export function installEmbeddingArtifact(
  dependencies: EmbeddingArtifactCommandDependencies,
): Promise<InstallLocalEmbeddingArtifactResult> {
  const active = activeInstallations.get(dependencies);
  if (active) return active;

  const task = installEmbeddingArtifactOnce(dependencies);
  activeInstallations.set(dependencies, task);
  const clear = () => {
    if (activeInstallations.get(dependencies) === task) activeInstallations.delete(dependencies);
  };
  void task.then(clear, clear);
  return task;
}

async function installEmbeddingArtifactOnce(
  dependencies: EmbeddingArtifactCommandDependencies,
): Promise<InstallLocalEmbeddingArtifactResult> {
  const catalog = dependencies.getArtifactCatalog();
  const catalogStatus = catalog.getStatus();
  if (catalogStatus.state !== "available") {
    throw new Error(
      "Local embedding artifact installation is unavailable until the catalog has a complete SHA-256 manifest",
    );
  }

  const installer = dependencies.getInstaller();
  const existingStatus = await installer.inspect(selectedModel);
  if (isCatalogArtifactInstalled(existingStatus, catalogStatus)) {
    return { alreadyInstalled: true, status: existingStatus };
  }

  const acceptedLicenseAt = requireTimestamp(dependencies.now());
  const approvedDownloadAt = Math.max(acceptedLicenseAt, requireTimestamp(dependencies.now()));
  const { plan, source } = catalog.createDownloadRequest({
    acceptedLicenseAt,
    acceptedLicenseId: catalogStatus.license.id,
    approvedDownloadAt,
  });
  await dependencies.downloadArtifact({ installer, plan, source });

  const status = await installer.inspect(selectedModel);
  if (!isCatalogArtifactInstalled(status, catalogStatus)) {
    throw new Error(
      "Local embedding artifact installation did not produce the catalog-pinned artifact",
    );
  }
  return { alreadyInstalled: false, status };
}

function isCatalogArtifactInstalled(
  status: LocalEmbeddingArtifactStatus,
  catalog: Extract<LocalEmbeddingArtifactCatalogStatus, { state: "available" }>,
): status is Extract<LocalEmbeddingArtifactStatus, { state: "ready" }> {
  return (
    status.state === "ready" &&
    status.artifact.modelId === selectedModel.id &&
    status.artifact.manifestSha256 === catalog.artifact.manifestSha256 &&
    status.artifact.modelRevision === catalog.artifact.modelRevision
  );
}

function requireTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Local embedding artifact consent timestamp is invalid");
  }
  return value;
}

export function createDefaultEmbeddingArtifactDownload(
  request: EmbeddingArtifactDownloadRequest,
): Promise<void> {
  return downloadAndInstallLocalEmbeddingArtifact(request).then(() => undefined);
}
