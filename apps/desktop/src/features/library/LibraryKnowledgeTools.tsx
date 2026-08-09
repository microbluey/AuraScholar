import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import { resolveKnowledgeSearchReaderPath } from "../../services/knowledge-search-navigation";
import { describeSafeError } from "../../services/sensitive-text";
import { KnowledgeIndexPlanner } from "./KnowledgeIndexPlanner";
import { KnowledgeSearchPanel } from "./KnowledgeSearchPanel";
import { LocalSemanticIndexControl } from "./LocalSemanticIndexControl";

export interface LibraryKnowledgeToolsProps {
  enabled: boolean;
  onMessage: (message: string) => void;
  onSelectWork: (workId: string | null) => void;
}

/** Keeps knowledge-search navigation and local-index controls outside the large Library page. */
export function LibraryKnowledgeTools({
  enabled,
  onMessage,
  onSelectWork,
}: LibraryKnowledgeToolsProps) {
  const navigate = useNavigate();
  const openKnowledgeSearchResult = useCallback(
    async (result: KnowledgeContentSearchResult) => {
      const workId = result.workId?.trim();
      if (!workId) {
        onMessage("该检索结果没有可打开的文献来源。");
        return;
      }
      try {
        const readerPath = await resolveKnowledgeSearchReaderPath(result);
        if (!readerPath) {
          onMessage("该检索结果的原始 PDF 修订不可用，未跳转到其他版本。");
          return;
        }
        onSelectWork(workId);
        navigate(readerPath);
      } catch (cause) {
        onMessage(`打开检索来源失败:${describeSafeError(cause)}`);
      }
    },
    [navigate, onMessage, onSelectWork],
  );

  return (
    <>
      <KnowledgeSearchPanel enabled={enabled} onOpenResult={openKnowledgeSearchResult} />
      <LocalSemanticIndexControl enabled={enabled} />
      <KnowledgeIndexPlanner enabled={enabled} />
    </>
  );
}
