import type {
  BuildKnowledgeSemanticIndexResult,
  KnowledgeSemanticIndexStatus,
} from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";

export type {
  BuildKnowledgeSemanticIndexResult,
  KnowledgeSemanticIndexStatus,
} from "../../electron/data-command-contract";

/** Starts the fixed local-only model/index workflow; renderer supplies no model or path. */
export async function buildKnowledgeSemanticIndex(
  options: { signal?: AbortSignal } = {},
): Promise<BuildKnowledgeSemanticIndexResult> {
  options.signal?.throwIfAborted();
  const libraryId = await getActiveLibraryCommandScope();
  options.signal?.throwIfAborted();
  const result = await window.aura.data.command("knowledge.buildSemanticIndex", { libraryId });
  options.signal?.throwIfAborted();
  return result;
}

/** Reads safe generation counts only; it never loads a model or embeds text. */
export async function getKnowledgeSemanticIndexStatus(
  options: { signal?: AbortSignal } = {},
): Promise<KnowledgeSemanticIndexStatus> {
  options.signal?.throwIfAborted();
  const libraryId = await getActiveLibraryCommandScope();
  options.signal?.throwIfAborted();
  const result = await window.aura.data.command("knowledge.getSemanticIndexStatus", { libraryId });
  options.signal?.throwIfAborted();
  return result.status;
}
