import type { KnowledgeContentIndexStats } from "../../electron/data-command-contract";
import { decodeKnowledgeGetContentStatsResult } from "../shared/knowledge-command-result-codec";
import { getActiveLibraryCommandScopeToken } from "./library-command-scope";

export type { KnowledgeContentIndexStats } from "../../electron/data-command-contract";

/**
 * Reads the active local ContentUnit counts used by semantic-index planning.
 * It does not create an index, load an embedding model, or send Library data.
 */
export async function getKnowledgeContentIndexStats(
  options: { signal?: AbortSignal } = {},
): Promise<KnowledgeContentIndexStats> {
  options.signal?.throwIfAborted();
  const expectedScope = await getActiveLibraryCommandScopeToken();
  options.signal?.throwIfAborted();
  const response = await window.aura.data.command("knowledge.getContentStats", { expectedScope });
  options.signal?.throwIfAborted();
  return decodeKnowledgeGetContentStatsResult(response, expectedScope).stats;
}
