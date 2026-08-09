import { join } from "node:path";
import { app } from "electron";
import { CH } from "../shared";
import { handle } from "./ipc";
import {
  createDefaultEmbeddingArtifactDownload,
  getEmbeddingArtifactCatalogStatus,
  getEmbeddingArtifactStatus,
  installEmbeddingArtifact,
  removeEmbeddingArtifact,
  type EmbeddingArtifactCommandDependencies,
  type InstallLocalEmbeddingArtifactResult,
  type RemoveLocalEmbeddingArtifactResult,
} from "./embedding-artifact-command-service";
import { LOCAL_EMBEDDING_ARTIFACT_CATALOG } from "./local-embedding-artifact-catalog";
import {
  LocalEmbeddingArtifactInstaller,
  type LocalEmbeddingArtifactStatus,
} from "./local-embedding-artifact-installer";
import type { LocalEmbeddingArtifactCatalogStatus } from "./local-embedding-artifact-catalog";

export type {
  EmbeddingArtifactCommandDependencies,
  InstallLocalEmbeddingArtifactResult,
  RemoveLocalEmbeddingArtifactResult,
} from "./embedding-artifact-command-service";

let installer: LocalEmbeddingArtifactInstaller | null = null;

/**
 * Keeps the on-disk model root in the trusted main process. The fixed,
 * no-argument install command obtains this singleton only after catalog and
 * consent checks; the renderer never receives a staging path.
 */
export function getLocalEmbeddingArtifactInstaller(): LocalEmbeddingArtifactInstaller {
  installer ??= new LocalEmbeddingArtifactInstaller({
    rootDirectory: join(app.getPath("userData"), "models", "embedding"),
  });
  return installer;
}

const defaultDependencies: EmbeddingArtifactCommandDependencies = {
  downloadArtifact: createDefaultEmbeddingArtifactDownload,
  getArtifactCatalog: () => LOCAL_EMBEDDING_ARTIFACT_CATALOG,
  getInstaller: getLocalEmbeddingArtifactInstaller,
  now: Date.now,
};

export function registerEmbeddingArtifactHandlers(): void {
  handle(CH.embeddingArtifactCatalogStatus, () => getLocalEmbeddingArtifactCatalog());
  handle(CH.embeddingArtifactStatus, () => getLocalEmbeddingArtifactStatus());
  handle(CH.embeddingArtifactInstall, () => installLocalEmbeddingArtifact());
  handle(CH.embeddingArtifactRemove, () => removeLocalEmbeddingArtifact());
}

export async function getLocalEmbeddingArtifactCatalog(
  dependencies: EmbeddingArtifactCommandDependencies = defaultDependencies,
): Promise<LocalEmbeddingArtifactCatalogStatus> {
  return getEmbeddingArtifactCatalogStatus(dependencies);
}

export async function getLocalEmbeddingArtifactStatus(
  dependencies: EmbeddingArtifactCommandDependencies = defaultDependencies,
): Promise<LocalEmbeddingArtifactStatus> {
  return getEmbeddingArtifactStatus(dependencies);
}

export function installLocalEmbeddingArtifact(
  dependencies: EmbeddingArtifactCommandDependencies = defaultDependencies,
): Promise<InstallLocalEmbeddingArtifactResult> {
  return installEmbeddingArtifact(dependencies);
}

export async function removeLocalEmbeddingArtifact(
  dependencies: EmbeddingArtifactCommandDependencies = defaultDependencies,
): Promise<RemoveLocalEmbeddingArtifactResult> {
  return removeEmbeddingArtifact(dependencies);
}
