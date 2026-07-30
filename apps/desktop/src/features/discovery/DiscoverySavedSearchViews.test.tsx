import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SavedSearchView } from "../../services/saved-searches";
import {
  DiscoverySavedSearchRecentStrip,
  DiscoverySavedSearchRouteSummary,
} from "./DiscoverySavedSearchHome";
import { DiscoverySavedSearchPanel } from "./DiscoverySavedSearchPanel";
import type {
  DiscoverySavedSearchRowAction,
  DiscoverySavedSearchSnapshot,
} from "./discovery-saved-search-model";

function savedSearch(id: string, overrides: Partial<SavedSearchView> = {}): SavedSearchView {
  return {
    id,
    lastError: null,
    lastRunAt: null,
    newCount: 0,
    query: `Query ${id}`,
    sources: ["openalex"],
    ...overrides,
  };
}

function panelMarkup({
  items = [savedSearch("normal")],
  message = null,
  rowActions = new Map(),
  undo = null,
  undoBusy = false,
}: {
  items?: readonly SavedSearchView[];
  message?: string | null;
  rowActions?: ReadonlyMap<string, DiscoverySavedSearchRowAction>;
  undo?: DiscoverySavedSearchSnapshot["undo"];
  undoBusy?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <DiscoverySavedSearchPanel
      message={message}
      snapshot={{ items, rowActions, undo, undoBusy }}
      onCheck={vi.fn()}
      onDelete={vi.fn()}
      onOpen={vi.fn()}
      onUndo={vi.fn()}
    />,
  );
}

describe("Discovery Saved Search views", () => {
  it("preserves normal and failed subscription row selectors and actions", () => {
    const markup = panelMarkup({
      items: [
        savedSearch("normal", { newCount: 2, query: "Normal subscription" }),
        savedSearch("failed", {
          lastError: "Smoke saved search network failure",
          query: "Failed subscription",
        }),
      ],
    });

    expect(markup).toContain('class="discovery-subs"');
    expect(markup.match(/class="discovery-sub"/g)).toHaveLength(2);
    expect(markup).toContain('class="discovery-sub__main"');
    expect(markup).toContain('title="点击重新运行此检索"');
    expect(markup).toContain('title="立即检查新结果"');
    expect(markup).toContain('title="删除订阅"');
    expect(markup).toContain("Normal subscription");
    expect(markup).toContain("2 新");
    expect(markup).toContain('title="最近检查失败:Smoke saved search network failure"');
    expect(markup).toContain("最近失败:Smoke saved search network failure");
    expect(markup).toContain("检查失败");
    expect(markup).toContain(">↻</button>");
    expect(markup).toContain(">×</button>");
  });

  it.each([
    {
      action: "opening" as const,
      ariaBusyCount: 1,
      expectedMainTitle: "正在打开订阅",
      expectedStatus: "正在打开订阅...",
    },
    {
      action: "checking" as const,
      ariaBusyCount: 1,
      expectedMainTitle: "正在检查新结果",
      expectedStatus: "…",
    },
    {
      action: "deleting" as const,
      ariaBusyCount: 2,
      expectedMainTitle: "正在删除订阅",
      expectedStatus: "正在删除订阅...",
    },
  ])(
    "preserves $action row busy semantics",
    ({ action, ariaBusyCount, expectedMainTitle, expectedStatus }) => {
      const item = savedSearch(action, { query: `${action} subscription` });
      const markup = panelMarkup({
        items: [item],
        rowActions: new Map([[item.id, action]]),
      });

      expect(markup).toContain(`title="${expectedMainTitle}"`);
      expect(markup).toContain("disabled");
      expect(markup.match(/aria-busy="true"/g)).toHaveLength(ariaBusyCount);
      expect(markup).toContain(expectedStatus);
      expect(markup).toContain('title="订阅操作进行中"');
      if (action === "checking") {
        expect(markup).toContain('title="正在检查新结果"');
        expect(markup).toContain(">…</button>");
      }
      if (action === "deleting") {
        expect(markup).toContain(">…</button>");
      }
    },
  );

  it("keeps undo available when a committed delete is followed by refresh failure", () => {
    const item = savedSearch("deleted", { query: "Deleted subscription" });
    const undoMessage = `已删除检索订阅:“${item.query}”`;
    const markup = panelMarkup({
      message: `${undoMessage}，但列表刷新失败，可稍后刷新:database unavailable`,
      undo: { item, message: undoMessage },
    });

    expect(markup).toContain("library-command__message");
    expect(markup).toContain('aria-label="撤销删除检索订阅"');
    expect(markup).toContain("列表刷新失败");
    expect(markup).toContain(">撤销</button>");
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("preserves the undo busy state and retry entry point", () => {
    const item = savedSearch("deleted", { query: "Deleted subscription" });
    const markup = panelMarkup({
      message: "正在撤销删除检索订阅...",
      undo: { item, message: `已删除检索订阅:“${item.query}”` },
      undoBusy: true,
    });

    expect(markup).toContain('aria-label="撤销删除检索订阅"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain(">撤销中...</button>");
  });

  it("keeps an unconsumed undo visible when another status message arrives", () => {
    const item = savedSearch("deleted", { query: "Deleted subscription" });
    const markup = panelMarkup({
      message: "暂无新结果",
      undo: { item, message: `已删除检索订阅:“${item.query}”` },
    });

    expect(markup).toContain("暂无新结果");
    expect(markup).toContain('aria-label="撤销删除检索订阅"');
  });

  it("renders the home route summary for populated and empty subscriptions", () => {
    const populated = renderToStaticMarkup(
      <DiscoverySavedSearchRouteSummary newCount={5} recentCount={3} />,
    );
    const empty = renderToStaticMarkup(
      <DiscoverySavedSearchRouteSummary newCount={0} recentCount={0} />,
    );

    expect(populated).toContain('class="discovery-route-card discovery-route-card--passive"');
    expect(populated).toContain("检索订阅");
    expect(populated).toContain("3 个近期订阅 · 5 个新结果");
    expect(empty).toContain("保存主题后自动追踪新论文");
  });

  it("preserves recent-strip selectors, counts, labels, and row busy states", () => {
    const opening = savedSearch("opening", { query: "Opening subscription" });
    const deleting = savedSearch("deleting", { query: "Deleting subscription" });
    const fresh = savedSearch("fresh", {
      newCount: 3,
      query: "Fresh subscription",
    });
    const neverRun = savedSearch("never-run", { query: "Never run subscription" });
    const markup = renderToStaticMarkup(
      <DiscoverySavedSearchRecentStrip
        items={[opening, deleting, fresh, neverRun]}
        rowActions={
          new Map([
            [opening.id, "opening"],
            [deleting.id, "deleting"],
          ])
        }
        onOpen={vi.fn()}
      />,
    );

    expect(markup).toContain('class="discovery-saved-strip"');
    expect(markup).toContain("近期订阅");
    expect(markup).toContain("打开中...");
    expect(markup).toContain("删除中...");
    expect(markup).toContain("3 新");
    expect(markup).toContain("尚未运行");
    expect(markup.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(markup.match(/disabled/g)).toHaveLength(2);
  });

  it("omits the recent strip when no subscriptions exist", () => {
    const markup = renderToStaticMarkup(
      <DiscoverySavedSearchRecentStrip items={[]} rowActions={new Map()} onOpen={vi.fn()} />,
    );

    expect(markup).toBe("");
  });
});
