// Writing snippets workspace: every excerpt collected while reading, grouped by
// source paper. Edit notes, copy for pasting into a manuscript, and jump back
// to the source page (溯源). Closes the read -> write loop.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { Badge, Button, Card } from "@aurascholar/ui";
import type { SnippetWithWork } from "@aurascholar/db";
import { STYLES } from "@aurascholar/cite";
import {
  deleteSnippet,
  listAllSnippets,
  restoreSnippet,
  updateSnippetNote,
} from "../services/snippets";
import { listWorks } from "../services/library-list";
import { referenceForWork } from "../services/cite";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { writeClipboardText } from "../clipboard";
import { isImeComposing } from "../keyboard";
import { readLocalStorageItem, tryWriteLocalStorageItem } from "../storage";
import { isDesktopRuntime } from "../services/aura-platform";
import { describeSafeError } from "../services/sensitive-text";

const STYLE_KEY = "snippet-cite-style";
const MIN_SNIPPET_ACTION_BUSY_MS = 250;

type SnippetFilter = "all" | "noted" | "unnoted";
type SnippetCardAction = "copy" | "copy-citation" | "delete-confirm" | "delete" | null;

interface WorkGroup {
  workId: string;
  workTitle: string;
  items: SnippetWithWork[];
}

interface SnippetUndoState {
  id: string;
  message: string;
  snippet: SnippetWithWork;
}

interface SnippetsSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__?: number;
  __AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__?: string;
  __AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__?: string;
  __AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__?: string;
  __AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__?: string;
}

function snippetContextLabel(snippet: SnippetWithWork): string {
  const pageLabel = snippet.page_index != null ? `第 ${snippet.page_index + 1} 页` : "未记录页码";
  const quote = snippet.quote.trim().replace(/\s+/g, " ");
  const preview = quote.length > 42 ? `${quote.slice(0, 42)}…` : quote;
  return preview ? `${pageLabel}素材，${preview}` : `${pageLabel}素材`;
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

async function waitForSnippetsSmokeAfterReadDelay(): Promise<void> {
  const smokeWindow = window as SnippetsSmokeWindow;
  const delayMs = smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_DELAY_MS__;
  if (typeof delayMs !== "number" || delayMs <= 0) return;
  smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__ =
    (smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_AFTER_READ_COUNT__ ?? 0) + 1;
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function consumeSnippetsSmokeReadFailure(): Error | null {
  const smokeWindow = window as SnippetsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__;
  return new Error(message);
}

function consumeSnippetsSmokeSaveFailure(): Error | null {
  const smokeWindow = window as SnippetsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_SAVE__;
  return new Error(message);
}

function consumeSnippetsSmokeDeleteFailure(): Error | null {
  const smokeWindow = window as SnippetsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_DELETE__;
  return new Error(message);
}

function consumeSnippetsSmokeRestoreFailure(): Error | null {
  const smokeWindow = window as SnippetsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_RESTORE__;
  return new Error(message);
}

function normalizeCiteStyle(value: string | null): string {
  return value && STYLES.some((style) => style.id === value) ? value : "apa";
}

const PREVIEW_SNIPPET_TIMESTAMP = Date.UTC(2026, 6, 1, 9, 0, 0);

const PREVIEW_SNIPPETS: SnippetWithWork[] = [
  {
    id: "preview-snippet-attention-1",
    work_id: "preview-attention",
    work_title: "Attention Is All You Need",
    page_index: 2,
    quote:
      "The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality.",
    note_md: "适合放在方法综述里，解释为什么注意力结构改变了训练效率。",
    tag: "method",
    created_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 12,
    updated_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 8,
  },
  {
    id: "preview-snippet-attention-2",
    work_id: "preview-attention",
    work_title: "Attention Is All You Need",
    page_index: 5,
    quote:
      "Multi-head attention allows the model to jointly attend to information from different representation subspaces.",
    note_md: "写模型结构小节时可以改写成“多视角关系建模”。",
    tag: "architecture",
    created_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 20,
    updated_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 20,
  },
  {
    id: "preview-snippet-alphafold-1",
    work_id: "preview-alphafold",
    work_title: "Highly accurate protein structure prediction with AlphaFold",
    page_index: 4,
    quote:
      "AlphaFold produces highly accurate structures with an end-to-end neural network trained directly from sequence and structure data.",
    note_md: "可用于说明端到端学习如何替代传统多阶段结构预测管线。",
    tag: "evidence",
    created_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 34,
    updated_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 30,
  },
  {
    id: "preview-snippet-scaling-1",
    work_id: "preview-scaling-laws",
    work_title: "Scaling Laws for Neural Language Models",
    page_index: 3,
    quote:
      "Performance depends strongly on scale, which consists of three factors: model size, dataset size, and the amount of compute used for training.",
    note_md: "放在实验预算段，连接模型规模、数据量和计算成本三者的取舍。",
    tag: "planning",
    created_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 46,
    updated_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 46,
  },
  {
    id: "preview-snippet-sam-1",
    work_id: "preview-sam",
    work_title: "Segment Anything",
    page_index: 1,
    quote:
      "A promptable segmentation task enables zero-shot transfer to new image distributions and tasks.",
    note_md: null,
    tag: "todo",
    created_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 58,
    updated_at: PREVIEW_SNIPPET_TIMESTAMP - 1000 * 60 * 58,
  },
];

const PREVIEW_SNIPPET_REFERENCES: Record<string, string> = {
  "preview-attention": "Vaswani et al. (2017). Attention Is All You Need.",
  "preview-alphafold":
    "Jumper et al. (2021). Highly accurate protein structure prediction with AlphaFold.",
  "preview-scaling-laws": "Kaplan et al. (2020). Scaling Laws for Neural Language Models.",
  "preview-sam": "Kirillov et al. (2023). Segment Anything.",
};

const PREVIEW_SNIPPET_LATEST_WORK = {
  id: "preview-attention",
  title: "Attention Is All You Need",
};
const PREVIEW_SNIPPETS_SCOPE_MESSAGE =
  "浏览器预览使用可重置的写作素材样例；复制、批注、删除和撤销会在本页模拟生效，真实素材和批注会在桌面应用中保存。";

function groupSnippets(rows: SnippetWithWork[]): WorkGroup[] {
  const byWork = new Map<string, WorkGroup>();
  for (const row of rows) {
    const group = byWork.get(row.work_id) ?? {
      workId: row.work_id,
      workTitle: row.work_title,
      items: [],
    };
    group.items.push(row);
    byWork.set(row.work_id, group);
  }
  return [...byWork.values()];
}

function previewReferenceForWork(workId: string): string {
  return PREVIEW_SNIPPET_REFERENCES[workId] ?? "";
}

export function SnippetsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [latestWork, setLatestWork] = useState<{ id: string; title: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SnippetFilter>("all");
  const [copyingVisible, setCopyingVisible] = useState(false);
  const [citeStyle, setCiteStyle] = useState(() =>
    normalizeCiteStyle(readLocalStorageItem(STYLE_KEY)),
  );
  const { confirm, confirmDialog } = useConfirmDialog();
  const [dirtySnippetIds, setDirtySnippetIds] = useState<Set<string>>(() => new Set());
  const [snippetUndo, setSnippetUndo] = useState<SnippetUndoState | null>(null);
  const [snippetUndoBusy, setSnippetUndoBusy] = useState(false);
  const refreshSeqRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const dirtySnippetCount = dirtySnippetIds.size;
  const hasDirtyNotes = dirtySnippetCount > 0;

  const markSnippetDirty = useCallback((id: string, dirty: boolean) => {
    setDirtySnippetIds((current) => {
      const alreadyDirty = current.has(id);
      if (alreadyDirty === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const changeStyle = useCallback((style: string) => {
    const next = normalizeCiteStyle(style);
    setCiteStyle(next);
    if (!tryWriteLocalStorageItem(STYLE_KEY, next)) {
      setMessage("浏览器阻止了引文格式偏好保存，本次选择只在当前页面生效。");
    }
  }, []);

  useEffect(() => {
    if (!hasDirtyNotes) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasDirtyNotes]);

  const refresh = useCallback(async () => {
    const seq = refreshSeqRef.current + 1;
    refreshSeqRef.current = seq;
    if (!isDesktopRuntime()) {
      if (refreshSeqRef.current !== seq) return;
      setGroups(groupSnippets(PREVIEW_SNIPPETS));
      setLatestWork(PREVIEW_SNIPPET_LATEST_WORK);
      setLoading(false);
      setLoadError(null);
      setMessage((current) => current ?? PREVIEW_SNIPPETS_SCOPE_MESSAGE);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const smokeFailure = consumeSnippetsSmokeReadFailure();
      if (smokeFailure) throw smokeFailure;
      const [rows, recentWorks] = await Promise.all([
        listAllSnippets(),
        listWorks(undefined, undefined, 1).catch(() => []),
      ]);
      await waitForSnippetsSmokeAfterReadDelay();
      if (refreshSeqRef.current !== seq) return;
      setGroups(groupSnippets(rows));
      setLatestWork(recentWorks[0] ? { id: recentWorks[0].id, title: recentWorks[0].title } : null);
      setLoadError(null);
      setMessage((current) => (current?.startsWith("读取写作素材失败") ? null : current));
    } catch (e) {
      if (refreshSeqRef.current !== seq) return;
      const detail = describeSafeError(e);
      setLoadError(detail);
      setMessage(`读取写作素材失败：${detail}`);
    } finally {
      if (refreshSeqRef.current === seq) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshId = window.setTimeout(() => {
      void refresh();
    }, 0);
    const onUpdated = () => void refresh();
    window.addEventListener("aurascholar:snippets-updated", onUpdated);
    return () => {
      window.clearTimeout(refreshId);
      refreshSeqRef.current += 1;
      window.removeEventListener("aurascholar:snippets-updated", onUpdated);
    };
  }, [refresh]);

  const allSnippets = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const total = allSnippets.length;
  const notedCount = useMemo(
    () => allSnippets.filter((snippet) => Boolean(snippet.note_md?.trim())).length,
    [allSnippets],
  );
  const filteredGroups = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return groups
      .map((group) => {
        const items = group.items.filter((snippet) => {
          if (filter === "noted" && !snippet.note_md?.trim()) return false;
          if (filter === "unnoted" && snippet.note_md?.trim()) return false;
          if (!term) return true;
          return (
            group.workTitle.toLocaleLowerCase().includes(term) ||
            snippet.quote.toLocaleLowerCase().includes(term) ||
            (snippet.note_md ?? "").toLocaleLowerCase().includes(term)
          );
        });
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }, [filter, groups, query]);
  const visibleTotal = filteredGroups.reduce((sum, group) => sum + group.items.length, 0);

  const clearSnippetFilters = useCallback(() => {
    setQuery("");
    setFilter("all");
    setMessage(null);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const handleSnippetDeleted = useCallback((snippet: SnippetWithWork) => {
    const undoMessage = isDesktopRuntime() ? "素材已删除。" : "已从预览素材库删除，可撤销。";
    setGroups((currentGroups) =>
      currentGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.id !== snippet.id),
        }))
        .filter((group) => group.items.length > 0),
    );
    setSnippetUndo({ id: snippet.id, message: undoMessage, snippet });
    setMessage(undoMessage);
  }, []);

  const handleSnippetNoteSaved = useCallback((snippetId: string, noteMd: string) => {
    const normalizedNote = noteMd.trim() || null;
    setGroups((currentGroups) =>
      currentGroups.map((group) => ({
        ...group,
        items: group.items.map((snippet) =>
          snippet.id === snippetId
            ? { ...snippet, note_md: normalizedNote, updated_at: Date.now() }
            : snippet,
        ),
      })),
    );
  }, []);

  const undoSnippetDelete = useCallback(async () => {
    if (!snippetUndo || snippetUndoBusy) return;
    const startedAt = Date.now();
    setSnippetUndoBusy(true);
    setMessage("正在撤销删除素材...");
    if (!isDesktopRuntime()) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      setGroups((currentGroups) => {
        const existingGroup = currentGroups.find(
          (group) => group.workId === snippetUndo.snippet.work_id,
        );
        if (existingGroup) {
          return currentGroups.map((group) =>
            group.workId === snippetUndo.snippet.work_id
              ? { ...group, items: [snippetUndo.snippet, ...group.items] }
              : group,
          );
        }
        return [
          {
            workId: snippetUndo.snippet.work_id,
            workTitle: snippetUndo.snippet.work_title,
            items: [snippetUndo.snippet],
          },
          ...currentGroups,
        ];
      });
      setSnippetUndo(null);
      setMessage("已撤销删除预览素材。");
      setSnippetUndoBusy(false);
      return;
    }
    try {
      const smokeFailure = consumeSnippetsSmokeRestoreFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      await restoreSnippet(snippetUndo.id);
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      await refresh();
      setSnippetUndo(null);
      setMessage("已撤销删除素材。");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      setMessage(`撤销删除素材失败，撤销入口仍保留，可重新撤销：${describeSafeError(e)}`);
    } finally {
      setSnippetUndoBusy(false);
    }
  }, [refresh, snippetUndo, snippetUndoBusy]);

  const copyVisible = useCallback(async () => {
    if (copyingVisible) return;
    if (hasDirtyNotes) {
      setMessage("请先保存批注草稿，再复制可见素材。");
      return;
    }
    if (visibleTotal === 0) {
      setMessage("当前没有可复制的素材。");
      return;
    }
    const startedAt = Date.now();
    setCopyingVisible(true);
    setMessage("正在复制可见素材...");
    try {
      const blocks = await Promise.all(
        filteredGroups.map(async (group) => {
          const ref = isDesktopRuntime()
            ? await referenceForWork(group.workId, citeStyle).catch(() => "")
            : previewReferenceForWork(group.workId);
          const quotes = group.items
            .map((snippet) => {
              const page =
                snippet.page_index != null ? `第 ${snippet.page_index + 1} 页` : "页码未记录";
              const note = snippet.note_md?.trim() ? `\n  批注：${snippet.note_md.trim()}` : "";
              return `- "${snippet.quote}" (${page})${note}`;
            })
            .join("\n");
          return `${group.workTitle}\n${quotes}${ref ? `\n参考文献：${ref}` : ""}`;
        }),
      );
      await writeClipboardText(blocks.join("\n\n"));
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      setMessage(`已复制 ${visibleTotal} 条可见素材。`);
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      setMessage(`复制失败：${describeSafeError(e)}`);
    } finally {
      setCopyingVisible(false);
    }
  }, [citeStyle, copyingVisible, filteredGroups, hasDirtyNotes, visibleTotal]);

  return (
    <div className="snippets-page snippets-page--workbench">
      <div className="snippets-hero">
        <div>
          <p className="app-page-kicker">Writing desk</p>
          <h1 className="app-page-title">写作素材</h1>
          <p className="app-page-subtitle">
            阅读时随手摘录的语料，按文献分组；可加批注、复制到论文、一键溯源回原文。
          </p>
        </div>
        <div className="snippets-summary" aria-label="写作素材总览">
          <SummaryMetric label="素材" value={total} />
          <SummaryMetric label="来源文献" value={groups.length} />
          <SummaryMetric label="有批注" value={notedCount} />
        </div>
      </div>

      {snippetUndo &&
      (message === snippetUndo.message ||
        snippetUndoBusy ||
        message?.startsWith("撤销删除素材失败，撤销入口仍保留")) ? (
        <InlineNotice className="snippets-message" message={message}>
          <span className="snippets-message__text">{message}</span>
          <button
            type="button"
            className="snippets-message__action"
            onClick={() => void undoSnippetDelete()}
            disabled={snippetUndoBusy}
            aria-busy={snippetUndoBusy ? "true" : undefined}
            aria-label="撤销删除素材"
          >
            {snippetUndoBusy ? "撤销中..." : "撤销"}
          </button>
        </InlineNotice>
      ) : (
        <InlineNotice className="snippets-message" message={message} />
      )}

      {hasDirtyNotes && (
        <SnippetsNavigationGuard confirm={confirm} dirtySnippetCount={dirtySnippetCount} />
      )}

      {hasDirtyNotes && (
        <Card className="snippets-draft-banner" role="status" aria-live="polite">
          <Badge variant="warning">未保存</Badge>
          <div>
            <strong>{dirtySnippetCount} 条批注草稿尚未保存</strong>
            <p>保存后再跳转、溯源或刷新，才能确保这些写作想法不会丢。</p>
          </div>
        </Card>
      )}

      <div className="snippets-toolbar">
        <div className="snippets-search">
          <input
            ref={searchInputRef}
            className="au-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索素材、批注或来源文献"
            aria-label="搜索写作素材"
          />
        </div>
        <div className="snippets-filter-tabs" role="group" aria-label="素材筛选">
          {[
            { id: "all", label: "全部" },
            { id: "noted", label: "有批注" },
            { id: "unnoted", label: "待整理" },
          ].map((option) => (
            <button
              key={option.id}
              className={filter === option.id ? "snippets-filter-tab--active" : ""}
              type="button"
              aria-label={`${option.label}${filter === option.id ? "，当前筛选" : ""}`}
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id as SnippetFilter)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          className="au-input snippets-style-select"
          value={citeStyle}
          onChange={(e) => changeStyle(e.target.value)}
          aria-label="引文格式"
        >
          {STYLES.map((style) => (
            <option key={style.id} value={style.id}>
              {style.label}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={() => void copyVisible()}
          disabled={visibleTotal === 0 || copyingVisible}
          aria-busy={copyingVisible || undefined}
          aria-label={
            copyingVisible
              ? `正在复制 ${visibleTotal} 条可见写作素材`
              : `复制 ${visibleTotal} 条可见写作素材`
          }
          title={hasDirtyNotes ? "请先保存批注草稿" : undefined}
        >
          {copyingVisible ? "复制中..." : "复制可见素材"}
        </Button>
      </div>

      {loading ? (
        <Card className="snippets-empty">
          <Badge variant="neutral">Loading</Badge>
          <p>正在读取写作素材</p>
        </Card>
      ) : loadError ? (
        <SnippetsLoadErrorState
          error={loadError}
          onRetry={() => void refresh()}
          onOpenLibrary={() => navigate("/library")}
        />
      ) : total === 0 ? (
        <SnippetsEmptyState
          previewMode={!isDesktopRuntime()}
          latestWorkTitle={latestWork?.title ?? null}
          onOpenLibrary={() => navigate("/library")}
          onOpenLatestWork={
            latestWork
              ? () => navigate(`/reader?work=${encodeURIComponent(latestWork.id)}`)
              : undefined
          }
        />
      ) : visibleTotal === 0 ? (
        <Card className="snippets-empty">
          <Badge variant="neutral">No match</Badge>
          <p>当前筛选没有素材</p>
          <small>换一个关键词或切回全部素材。</small>
          <div className="snippets-empty__actions">
            <Button type="button" onClick={clearSnippetFilters} aria-label="清空素材筛选">
              查看全部素材
            </Button>
          </div>
        </Card>
      ) : (
        <div className="snippets-groups">
          {filteredGroups.map((group) => (
            <section key={group.workId} className="snippets-group au-panel">
              <div className="snippets-group__head">
                <div>
                  <h2 title={group.workTitle}>{group.workTitle}</h2>
                  <p>{group.items.length} 条素材 · 可复制、批注、回源</p>
                </div>
                <Button
                  variant="secondary"
                  aria-label={`打开来源文献：${group.workTitle}`}
                  onClick={() =>
                    navigate(
                      isDesktopRuntime()
                        ? `/reader?work=${encodeURIComponent(group.workId)}`
                        : `/library?work=${encodeURIComponent(group.workId)}`,
                    )
                  }
                >
                  打开来源
                </Button>
              </div>
              <div className="snippets-stack">
                {group.items.map((snippet) => (
                  <SnippetCard
                    key={snippet.id}
                    snippet={snippet}
                    citeStyle={citeStyle}
                    confirm={confirm}
                    onDirtyChange={markSnippetDirty}
                    onDeleted={handleSnippetDeleted}
                    onMessage={setMessage}
                    onNoteSaved={handleSnippetNoteSaved}
                    onOpenSource={() =>
                      navigate(
                        isDesktopRuntime()
                          ? `/reader?work=${encodeURIComponent(snippet.work_id)}`
                          : `/library?work=${encodeURIComponent(snippet.work_id)}`,
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function SnippetsLoadErrorState({
  error,
  onRetry,
  onOpenLibrary,
}: {
  error: string;
  onRetry: () => void;
  onOpenLibrary: () => void;
}) {
  return (
    <Card className="snippets-empty snippets-empty--error">
      <Badge variant="danger">读取失败</Badge>
      <h2>写作素材暂时不可用</h2>
      <p>{error}</p>
      <small>素材和批注没有被清空，恢复后可以继续整理、复制和回到原文。</small>
      <div className="snippets-empty__actions">
        <Button type="button" onClick={onRetry} aria-label="重试读取写作素材">
          重试读取
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenLibrary}>
          去文献库
        </Button>
      </div>
    </Card>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
      <small>{label}</small>
    </span>
  );
}

function SnippetsNavigationGuard({
  confirm,
  dirtySnippetCount,
}: {
  confirm: ConfirmFunction;
  dirtySnippetCount: number;
}) {
  const blockerDialogOpenRef = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search,
  );

  useEffect(() => {
    if (blocker.state === "unblocked") {
      blockerDialogOpenRef.current = false;
    }
  }, [blocker.state]);

  useEffect(() => {
    if (blocker.state !== "blocked" || blockerDialogOpenRef.current) return;
    blockerDialogOpenRef.current = true;
    void confirm({
      cancelLabel: "继续整理",
      confirmLabel: "离开页面",
      description: "离开写作素材页会丢失尚未保存的批注草稿。",
      details: [
        `未保存批注：${dirtySnippetCount} 条`,
        "保存批注后，它才会进入复制素材和后续写作流程。",
      ],
      eyebrow: "未保存",
      title: "要离开写作素材吗？",
      tone: "warning",
    }).then((confirmed) => {
      blockerDialogOpenRef.current = false;
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
  }, [blocker, confirm, dirtySnippetCount]);

  return null;
}

function SnippetsEmptyState({
  previewMode,
  latestWorkTitle,
  onOpenLibrary,
  onOpenLatestWork,
}: {
  previewMode: boolean;
  latestWorkTitle: string | null;
  onOpenLibrary: () => void;
  onOpenLatestWork?: () => void;
}) {
  return (
    <Card className="snippets-empty snippets-empty--onboarding">
      <Badge variant={previewMode ? "warning" : "neutral"}>
        {previewMode ? "Preview" : "Start"}
      </Badge>
      <h2>先从阅读里摘一段好材料</h2>
      <p>
        在阅读器中选中文本，点击工具条上的星标按钮即可存为写作素材；稍后回到这里整理批注、复制引用、回到原文。
      </p>
      {latestWorkTitle && <small title={latestWorkTitle}>最近文献：{latestWorkTitle}</small>}
      <div className="snippets-empty__steps">
        <span>
          <strong>01</strong>
          导入 PDF
        </span>
        <span>
          <strong>02</strong>
          阅读时选中文本
        </span>
        <span>
          <strong>03</strong>
          保存为素材
        </span>
      </div>
      <div className="snippets-empty__actions">
        {onOpenLatestWork ? (
          <>
            <Button onClick={onOpenLatestWork}>打开最近文献</Button>
            <Button variant="secondary" onClick={onOpenLibrary}>
              选择其他文献
            </Button>
          </>
        ) : (
          <Button onClick={onOpenLibrary}>导入第一篇文献</Button>
        )}
      </div>
      {previewMode && <small>浏览器预览无法读取本地素材库，真实数据请在桌面应用中查看。</small>}
    </Card>
  );
}

function SnippetCard({
  snippet,
  citeStyle,
  confirm,
  onOpenSource,
  onMessage,
  onDirtyChange,
  onDeleted,
  onNoteSaved,
}: {
  snippet: SnippetWithWork;
  citeStyle: string;
  confirm: ConfirmFunction;
  onOpenSource: () => void;
  onMessage: (message: string | null) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onDeleted: (snippet: SnippetWithWork) => void;
  onNoteSaved: (snippetId: string, noteMd: string) => void;
}) {
  const propSavedNote = snippet.note_md ?? "";
  const [note, setNote] = useState(propSavedNote);
  const [optimisticSavedNote, setOptimisticSavedNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cardAction, setCardAction] = useState<SnippetCardAction>(null);
  const cardActionRef = useRef<SnippetCardAction>(null);
  const savedNote = optimisticSavedNote ?? propSavedNote;
  const noteDirty = editing && note !== savedNote;
  const cardActionBusy = cardAction !== null;
  const cardStatus =
    cardAction === "copy"
      ? "复制中..."
      : cardAction === "copy-citation"
        ? "生成引文..."
        : cardAction === "delete-confirm"
          ? "等待确认..."
          : cardAction === "delete"
            ? "删除中..."
            : (copied ?? "Ready");
  const snippetLabel = snippetContextLabel(snippet);

  const setRunningAction = useCallback((action: SnippetCardAction) => {
    cardActionRef.current = action;
    setCardAction(action);
  }, []);

  useEffect(() => {
    const resetId = window.setTimeout(() => {
      setOptimisticSavedNote(null);
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [propSavedNote]);

  useEffect(() => {
    if (editing) return;
    const syncId = window.setTimeout(() => {
      setNote(savedNote);
    }, 0);
    return () => window.clearTimeout(syncId);
  }, [editing, savedNote]);

  useEffect(() => {
    onDirtyChange(snippet.id, noteDirty);
  }, [noteDirty, onDirtyChange, snippet.id]);

  useEffect(() => {
    return () => onDirtyChange(snippet.id, false);
  }, [onDirtyChange, snippet.id]);

  const flash = useCallback((label: string) => {
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }, []);

  const saveNote = useCallback(
    async (draftNote = note) => {
      const startedAt = Date.now();
      setSaving(true);
      try {
        const nextNote = draftNote.trim();
        if (!isDesktopRuntime()) {
          await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
          setOptimisticSavedNote(nextNote);
          setNote(nextNote);
          onNoteSaved(snippet.id, nextNote);
          setEditing(false);
          onDirtyChange(snippet.id, false);
          onMessage("预览批注已在当前页面更新；真实批注会在桌面应用中保存。");
          return;
        }
        const smokeFailure = consumeSnippetsSmokeSaveFailure();
        if (smokeFailure) throw smokeFailure;
        await updateSnippetNote(snippet.id, nextNote || null);
        setOptimisticSavedNote(nextNote);
        setNote(nextNote);
        onNoteSaved(snippet.id, nextNote);
        setEditing(false);
        onDirtyChange(snippet.id, false);
        onMessage("批注已保存。");
      } catch (e) {
        onMessage(`保存批注失败，草稿仍保留，可重新保存：${describeSafeError(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [note, onDirtyChange, onMessage, onNoteSaved, snippet.id],
  );

  const cancelEdit = useCallback(
    async (draftNote = note) => {
      if (draftNote !== savedNote) {
        const confirmed = await confirm({
          cancelLabel: "继续编辑",
          confirmLabel: "放弃草稿",
          description: "这条批注里还有未保存的修改。",
          details: ["放弃后会恢复到上一次保存的批注内容。"],
          eyebrow: "未保存",
          title: "放弃这条批注草稿吗？",
          tone: "warning",
        });
        if (!confirmed) return;
      }
      setNote(savedNote);
      setEditing(false);
      onDirtyChange(snippet.id, false);
    },
    [confirm, note, onDirtyChange, savedNote, snippet.id],
  );

  const handleNoteKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(event)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!saving) void saveNote(event.currentTarget.value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (!saving) void cancelEdit(event.currentTarget.value);
      }
    },
    [cancelEdit, saveNote, saving],
  );

  const copyQuote = useCallback(async () => {
    if (cardActionRef.current) return;
    const startedAt = Date.now();
    setRunningAction("copy");
    try {
      await writeClipboardText(snippet.quote);
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      flash("已复制");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onMessage(`复制失败：${describeSafeError(e)}`);
    } finally {
      setRunningAction(null);
    }
  }, [flash, onMessage, setRunningAction, snippet.quote]);

  const copyWithCitation = useCallback(async () => {
    if (cardActionRef.current) return;
    const startedAt = Date.now();
    setRunningAction("copy-citation");
    try {
      const ref = isDesktopRuntime()
        ? await referenceForWork(snippet.work_id, citeStyle).catch(() => "")
        : previewReferenceForWork(snippet.work_id);
      const page = snippet.page_index != null ? `(p. ${snippet.page_index + 1})` : "";
      const note = savedNote.trim() ? `\n\n批注：${savedNote.trim()}` : "";
      const text = ref ? `"${snippet.quote}" ${page}${note}\n\n${ref}` : snippet.quote;
      await writeClipboardText(text);
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      flash("已复制含引文");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onMessage(`复制失败：${describeSafeError(e)}`);
    } finally {
      setRunningAction(null);
    }
  }, [citeStyle, flash, onMessage, savedNote, setRunningAction, snippet]);

  const remove = useCallback(async () => {
    if (cardActionRef.current) return;
    setRunningAction("delete-confirm");
    const confirmed = await confirm({
      title: "删除写作素材？",
      description: "这条摘录会从写作素材列表移除。",
      details: ["来源文献、PDF 和阅读批注不会被删除。", "已复制到手稿中的内容不受影响。"],
      confirmLabel: "删除素材",
      tone: "warning",
    });
    if (!confirmed) {
      setRunningAction(null);
      return;
    }
    const startedAt = Date.now();
    setRunningAction("delete");
    onMessage("正在删除素材...");
    try {
      if (!isDesktopRuntime()) {
        await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
        onDeleted(snippet);
        return;
      }
      const smokeFailure = consumeSnippetsSmokeDeleteFailure();
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
        throw smokeFailure;
      }
      await deleteSnippet(snippet.id);
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onDeleted(snippet);
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onMessage(`删除素材失败，素材仍保留，可重新删除：${describeSafeError(e)}`);
    } finally {
      setRunningAction(null);
    }
  }, [confirm, onDeleted, onMessage, setRunningAction, snippet]);

  return (
    <article className="snippet-card">
      <div className="snippet-card__topline">
        <Badge variant={savedNote.trim() ? "success" : "neutral"}>
          {savedNote.trim() ? "已批注" : "待整理"}
        </Badge>
        <span>{snippet.page_index != null ? `第 ${snippet.page_index + 1} 页` : "未记录页码"}</span>
      </div>
      <blockquote className="snippet-card__quote">{snippet.quote}</blockquote>
      {editing ? (
        <div className="snippet-card__note-edit">
          <div className="snippet-card__note-edit-head">
            <span>批注草稿</span>
            <Badge variant={noteDirty ? "warning" : "neutral"}>
              {noteDirty ? "未保存" : "已同步"}
            </Badge>
          </div>
          <textarea
            className="au-input"
            rows={3}
            value={note}
            aria-label={`编辑${snippetLabel}批注`}
            placeholder="加一条批注：为什么有用、适合放在哪个段落、要如何改写..."
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleNoteKeyDown}
          />
          <div className="snippet-card__actions">
            <Button
              onClick={() => void saveNote()}
              disabled={saving}
              aria-busy={saving || undefined}
              aria-label={saving ? `正在保存${snippetLabel}批注` : `保存${snippetLabel}批注`}
            >
              {saving ? "保存中..." : "保存批注"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void cancelEdit()}
              disabled={saving}
              aria-label={`取消编辑${snippetLabel}批注`}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          {savedNote && <p className="snippet-card__note">{savedNote}</p>}
          <div className="snippet-card__actions">
            <span className="snippet-card__meta" aria-live="polite">
              {cardStatus}
            </span>
            <button
              type="button"
              disabled={cardActionBusy}
              aria-busy={cardAction === "copy" || undefined}
              aria-label={cardAction === "copy" ? `正在复制${snippetLabel}` : `复制${snippetLabel}`}
              onClick={() => void copyQuote()}
            >
              {cardAction === "copy" ? "复制中..." : "复制"}
            </button>
            <button
              type="button"
              disabled={cardActionBusy}
              aria-busy={cardAction === "copy-citation" || undefined}
              aria-label={
                cardAction === "copy-citation"
                  ? `正在生成${snippetLabel}引文`
                  : `复制${snippetLabel}和引文`
              }
              onClick={() => void copyWithCitation()}
            >
              {cardAction === "copy-citation" ? "生成中..." : "复制+引文"}
            </button>
            <button
              type="button"
              disabled={cardActionBusy}
              aria-label={`${savedNote ? "编辑" : "添加"}${snippetLabel}批注`}
              onClick={() => setEditing(true)}
            >
              {savedNote ? "编辑批注" : "加批注"}
            </button>
            <button
              type="button"
              disabled={cardActionBusy}
              aria-label={`回到${snippetLabel}来源`}
              onClick={onOpenSource}
            >
              溯源
            </button>
            <button
              type="button"
              className="snippet-card__delete"
              disabled={cardActionBusy}
              aria-busy={cardAction === "delete-confirm" || cardAction === "delete" || undefined}
              aria-label={
                cardAction === "delete"
                  ? `正在删除${snippetLabel}`
                  : cardAction === "delete-confirm"
                    ? `正在确认删除${snippetLabel}`
                    : `删除${snippetLabel}`
              }
              onClick={() => void remove()}
            >
              {cardAction === "delete-confirm"
                ? "确认中..."
                : cardAction === "delete"
                  ? "删除中..."
                  : "删除"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
