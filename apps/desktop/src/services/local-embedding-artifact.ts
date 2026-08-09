import type {
  InstallLocalEmbeddingArtifactResult,
  RemoveLocalEmbeddingArtifactResult,
} from "../../electron/main/embedding-artifact-commands";
import type { LocalEmbeddingArtifactCatalogStatus } from "../../electron/main/local-embedding-artifact-catalog";
import type { LocalEmbeddingArtifactStatus } from "../../electron/main/local-embedding-artifact-installer";

export type { LocalEmbeddingArtifactCatalogStatus } from "../../electron/main/local-embedding-artifact-catalog";
export type { LocalEmbeddingArtifactStatus } from "../../electron/main/local-embedding-artifact-installer";

/**
 * Renderer gateway for the deliberately narrow local-model bridge. It cannot
 * supply a path, URL, manifest, or model identifier to the main process.
 */
export async function getLocalEmbeddingArtifactStatus(): Promise<LocalEmbeddingArtifactStatus> {
  return window.aura.embedding.artifactStatus();
}

export async function getLocalEmbeddingArtifactCatalogStatus(): Promise<LocalEmbeddingArtifactCatalogStatus> {
  return window.aura.embedding.artifactCatalogStatus();
}

/** Fixed-model install request; the renderer cannot supply source or file data. */
export async function installLocalEmbeddingArtifact(): Promise<InstallLocalEmbeddingArtifactResult> {
  return window.aura.embedding.installArtifact();
}

export async function removeLocalEmbeddingArtifact(): Promise<RemoveLocalEmbeddingArtifactResult> {
  return window.aura.embedding.removeArtifact();
}
