import { assertKnowledgeJobLease } from "@aurascholar/db";
import { withMainDatabase, withMainDatabaseTransaction, getSqliteVecRuntimeStatus } from "./db";
import { getLocalEmbeddingArtifactInstaller } from "./embedding-artifact-commands";
import {
  LOCAL_EMBEDDING_MODEL_PRESETS,
  LocalEmbeddingProvider,
  type LocalEmbeddingArtifact,
} from "./local-embedding-provider";
import { TransformersJsLocalEmbeddingRuntime } from "./local-embedding-transformers-runtime";
import { LocalSemanticIndexService } from "./local-semantic-index-service";
import { assertActiveLibraryScopeToken } from "./library-scope-token";
import { sqliteVecIndexStore } from "./sqlite-vec-index-runtime";

const selectedModel = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;
const transformersRuntime = new TransformersJsLocalEmbeddingRuntime();

let cachedProvider: {
  artifactIdentity: string;
  provider: LocalEmbeddingProvider;
} | null = null;

/**
 * Resolves only an installer-verified artifact from the trusted main process.
 * The renderer has no route to this function, artifact root, or runtime.
 */
export async function getInstalledLocalEmbeddingProvider(): Promise<LocalEmbeddingProvider> {
  const artifact = await getLocalEmbeddingArtifactInstaller().getInstalledArtifact(selectedModel);
  if (!artifact) {
    cachedProvider = null;
    throw new Error("A verified local embedding model is required for semantic indexing");
  }
  const artifactIdentity = identityForArtifact(artifact);
  if (cachedProvider?.artifactIdentity === artifactIdentity) return cachedProvider.provider;

  const provider = new LocalEmbeddingProvider({
    artifact,
    model: selectedModel,
    runtime: transformersRuntime,
  });
  cachedProvider = { artifactIdentity, provider };
  return provider;
}

/** Production bridge for durable `embed` jobs and explicit semantic-index creation. */
export const localSemanticIndexService = new LocalSemanticIndexService({
  assertJobLease: assertKnowledgeJobLease,
  assertScope: assertActiveLibraryScopeToken,
  async ensureVectorRuntime() {
    const status = await getSqliteVecRuntimeStatus();
    if (status.state !== "available") {
      throw new Error("The local vector runtime is unavailable");
    }
  },
  getEmbeddingProvider: getInstalledLocalEmbeddingProvider,
  inspect: withMainDatabase,
  transaction: withMainDatabaseTransaction,
  vectorWriter: sqliteVecIndexStore,
});

function identityForArtifact(artifact: LocalEmbeddingArtifact): string {
  return [
    artifact.rootDirectory,
    artifact.manifestSha256,
    artifact.modelRevision,
    artifact.runtimeId,
    artifact.runtimeVersion,
  ].join("|");
}
