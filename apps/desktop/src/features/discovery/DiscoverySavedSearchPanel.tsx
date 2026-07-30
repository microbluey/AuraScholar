import { Badge } from "@aurascholar/ui";
import { InlineNotice } from "../../components/InlineNotice";
import type { SavedSearchView } from "../../services/saved-searches";
import type {
  DiscoverySavedSearchSnapshot,
  DiscoverySavedSearchUndo,
} from "./discovery-saved-search-model";

type SavedSearchPanelSnapshot = Pick<
  DiscoverySavedSearchSnapshot,
  "items" | "rowActions" | "undo" | "undoBusy"
>;

export interface DiscoverySavedSearchPanelProps {
  message: string | null;
  snapshot: SavedSearchPanelSnapshot;
  onCheck: (id: string) => void | Promise<void>;
  onDelete: (saved: SavedSearchView) => void | Promise<void>;
  onOpen: (saved: SavedSearchView) => void | Promise<void>;
  onUndo: () => void | Promise<void>;
}

export function DiscoverySavedSearchPanel({
  message,
  snapshot,
  onCheck,
  onDelete,
  onOpen,
  onUndo,
}: DiscoverySavedSearchPanelProps) {
  return (
    <>
      {snapshot.items.length > 0 && (
        <div className="discovery-subs">
          <div className="discovery-subs__head">检索订阅</div>
          <div className="discovery-subs__list">
            {snapshot.items.map((saved) => {
              const action = snapshot.rowActions.get(saved.id);
              const checking = action === "checking";
              const opening = action === "opening";
              const deleting = action === "deleting";
              return (
                <div key={saved.id} className="discovery-sub">
                  <button
                    type="button"
                    className="discovery-sub__main"
                    onClick={() => void onOpen(saved)}
                    title={
                      opening
                        ? "正在打开订阅"
                        : checking
                          ? "正在检查新结果"
                          : deleting
                            ? "正在删除订阅"
                            : saved.lastError
                              ? `最近检查失败:${saved.lastError}`
                              : "点击重新运行此检索"
                    }
                    disabled={checking || opening || deleting}
                    aria-busy={opening || deleting ? "true" : undefined}
                  >
                    <span className="discovery-sub__query-stack">
                      <span className="discovery-sub__query">{saved.query}</span>
                      {opening && <small className="discovery-sub__status">正在打开订阅...</small>}
                      {deleting && <small className="discovery-sub__status">正在删除订阅...</small>}
                      {saved.lastError && (
                        <small className="discovery-sub__error">最近失败:{saved.lastError}</small>
                      )}
                    </span>
                    {saved.newCount > 0 && <Badge variant="success">{saved.newCount} 新</Badge>}
                    {saved.lastError && <Badge variant="warning">检查失败</Badge>}
                  </button>
                  <button
                    type="button"
                    className="discovery-sub__action"
                    title={
                      deleting ? "正在删除订阅" : checking ? "正在检查新结果" : "立即检查新结果"
                    }
                    onClick={() => void onCheck(saved.id)}
                    disabled={checking || opening || deleting}
                    aria-busy={checking ? "true" : undefined}
                  >
                    {checking ? "…" : "↻"}
                  </button>
                  <button
                    type="button"
                    className="discovery-sub__action"
                    title={checking || opening || deleting ? "订阅操作进行中" : "删除订阅"}
                    onClick={() => void onDelete(saved)}
                    disabled={checking || opening || deleting}
                    aria-busy={deleting ? "true" : undefined}
                  >
                    {deleting ? "…" : "×"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SavedSearchNotice
        message={message}
        undo={snapshot.undo}
        undoBusy={snapshot.undoBusy}
        onUndo={onUndo}
      />
    </>
  );
}

function SavedSearchNotice({
  message,
  undo,
  undoBusy,
  onUndo,
}: {
  message: string | null;
  undo: DiscoverySavedSearchUndo | null;
  undoBusy: boolean;
  onUndo: () => void | Promise<void>;
}) {
  if (!undo) {
    return <InlineNotice className="library-command__message" message={message} />;
  }
  const visibleMessage = message ?? undo.message;

  return (
    <InlineNotice className="library-command__message" message={visibleMessage}>
      <span className="library-command__message-text">{visibleMessage}</span>
      <button
        type="button"
        className="library-command__message-action"
        onClick={() => void onUndo()}
        disabled={undoBusy}
        aria-busy={undoBusy ? "true" : undefined}
        aria-label="撤销删除检索订阅"
      >
        {undoBusy ? "撤销中..." : "撤销"}
      </button>
    </InlineNotice>
  );
}
