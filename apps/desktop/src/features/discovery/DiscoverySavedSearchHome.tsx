import type { SavedSearchView } from "../../services/saved-searches";
import type { DiscoverySavedSearchSnapshot } from "./discovery-saved-search-model";

type SavedSearchHomeSnapshot = Pick<DiscoverySavedSearchSnapshot, "items" | "rowActions">;

export function DiscoverySavedSearchRouteSummary({
  newCount,
  recentCount,
}: {
  newCount: number;
  recentCount: number;
}) {
  return (
    <div className="discovery-route-card discovery-route-card--passive">
      <span className="discovery-route-card__mark">↻</span>
      <strong>检索订阅</strong>
      <small>
        {recentCount
          ? `${recentCount} 个近期订阅 · ${newCount} 个新结果`
          : "保存主题后自动追踪新论文"}
      </small>
    </div>
  );
}

export interface DiscoverySavedSearchRecentStripProps {
  items: readonly SavedSearchView[];
  rowActions: SavedSearchHomeSnapshot["rowActions"];
  onOpen: (saved: SavedSearchView) => void | Promise<void>;
}

export function DiscoverySavedSearchRecentStrip({
  items,
  rowActions,
  onOpen,
}: DiscoverySavedSearchRecentStripProps) {
  if (items.length === 0) return null;

  return (
    <div className="discovery-saved-strip">
      <span>近期订阅</span>
      {items.map((saved) => {
        const action = rowActions.get(saved.id);
        const opening = action === "opening";
        const deleting = action === "deleting";
        return (
          <button
            key={saved.id}
            type="button"
            onClick={() => void onOpen(saved)}
            disabled={opening || deleting}
            aria-busy={opening || deleting ? "true" : undefined}
          >
            <strong>{saved.query}</strong>
            <small>
              {opening
                ? "打开中..."
                : deleting
                  ? "删除中..."
                  : saved.newCount
                    ? `${saved.newCount} 新`
                    : lastRunLabel(saved.lastRunAt)}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function lastRunLabel(value: number | null): string {
  if (!value) return "尚未运行";
  const delta = Date.now() - value;
  if (delta < 60_000) return "刚刚运行";
  if (delta < 60 * 60_000) return `${Math.max(1, Math.round(delta / 60_000))} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / (60 * 60_000))} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}
