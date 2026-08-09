import { KnowledgeIndexesRepo } from "@aurascholar/db";
import { withMainDatabase } from "./db";
import { getInstalledLocalEmbeddingProvider } from "./local-semantic-index-runtime";
import { LocalSemanticSearchService } from "./local-semantic-search-service";
import { sqliteVecIndexStore } from "./sqlite-vec-index-runtime";

/** Production-only semantic retrieval capability; it owns no renderer inputs. */
export const localSemanticSearchService = new LocalSemanticSearchService({
  async getActiveHybridIndexId(libraryId) {
    return withMainDatabase(async (database) => {
      const active = await new KnowledgeIndexesRepo(database, libraryId).getActiveCurrent();
      return active?.mode === "hybrid" ? active.id : null;
    });
  },
  getEmbeddingProvider: getInstalledLocalEmbeddingProvider,
  vectorStore: sqliteVecIndexStore,
});
