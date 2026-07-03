// Writing snippets workspace: every excerpt collected while reading, grouped by
// source paper. Edit notes, copy for pasting into a manuscript, and jump back
// to the source page (溯源). Closes the read -> write loop.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import type { SnippetWithWork } from "@aurascholar/db";
import { STYLES } from "@aurascholar/cite";
import { deleteSnippet, listAllSnippets, updateSnippetNote } from "../services/snippets";
import { referenceForWork } from "../services/cite";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { writeClipboardText } from "../clipboard";
import { isImeComposing } from "../keyboard";
import { readLocalStorageItem, tryWriteLocalStorageItem } from "../storage";

const STYLE_KEY = "snippet-cite-style";
const MIN_SNIPPET_ACTION_BUSY_MS = 250;

type SnippetFilter = "all" | "noted" | "unnoted";
type SnippetCardAction = "copy" | "copy-citation" | "delete-confirm" | "delete" | null;

interface WorkGroup {
  workId: string;
  workTitle: string;
  items: SnippetWithWork[];
}

function isTauriRuntime(): boolean {
  return "aura" in window;
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function normalizeCiteStyle(value: string | null): string {
  return value && STYLES.some((style) => style.id === value) ? value : "apa";
}

export function SnippetsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SnippetFilter>("all");
  const [copyingVisible, setCopyingVisible] = useState(false);
  const [citeStyle, setCiteStyle] = useState(() =>
    normalizeCiteStyle(readLocalStorageItem(STYLE_KEY)),
  );
  const { confirm, confirmDialog } = useConfirmDialog();
  const [dirtySnippetIds, setDirtySnippetIds] = useState<Set<string>>(() => new Set());

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
    if (!isTauriRuntime()) {
      setGroups([]);
      setLoading(false);
      setMessage(
        (current) => current ?? "浏览器预览无法读取本地写作素材，请在桌面应用中查看真实数据。",
      );
      return;
    }
    setLoading(true);
    try {
      const rows = await listAllSnippets();
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
      setGroups([...byWork.values()]);
      setMessage((current) => (current?.startsWith("读取写作素材失败") ? null : current));
    } catch (e) {
      setMessage(`读取写作素材失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdated = () => void refresh();
    window.addEventListener("aurascholar:snippets-updated", onUpdated);
    return () => window.removeEventListener("aurascholar:snippets-updated", onUpdated);
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
          const ref = await referenceForWork(group.workId, citeStyle).catch(() => "");
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
      setMessage(`复制失败：${e instanceof Error ? e.message : String(e)}`);
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

      <InlineNotice className="snippets-message" message={message} />

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
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索素材、批注或来源文献"
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
      ) : total === 0 ? (
        <SnippetsEmptyState
          previewMode={!isTauriRuntime()}
          onOpenLibrary={() => navigate("/library")}
          onOpenReader={() => navigate("/library")}
        />
      ) : visibleTotal === 0 ? (
        <Card className="snippets-empty">
          <Badge variant="neutral">No match</Badge>
          <p>当前筛选没有素材</p>
          <small>换一个关键词或切回全部素材。</small>
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
                  onClick={() => navigate(`/reader?work=${encodeURIComponent(group.workId)}`)}
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
                    onMessage={setMessage}
                    onOpenSource={() =>
                      navigate(`/reader?work=${encodeURIComponent(snippet.work_id)}`)
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
  onOpenLibrary,
  onOpenReader,
}: {
  previewMode: boolean;
  onOpenLibrary: () => void;
  onOpenReader: () => void;
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
        <Button onClick={onOpenLibrary}>去文献库</Button>
        <Button variant="secondary" onClick={onOpenReader}>
          选择一篇文献
        </Button>
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
}: {
  snippet: SnippetWithWork;
  citeStyle: string;
  confirm: ConfirmFunction;
  onOpenSource: () => void;
  onMessage: (message: string | null) => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
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
            : copied ?? "Ready";

  const setRunningAction = useCallback((action: SnippetCardAction) => {
    cardActionRef.current = action;
    setCardAction(action);
  }, []);

  useEffect(() => {
    setOptimisticSavedNote(null);
  }, [propSavedNote]);

  useEffect(() => {
    if (!editing) setNote(savedNote);
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

  const saveNote = useCallback(async (draftNote = note) => {
    setSaving(true);
    try {
      const nextNote = draftNote.trim();
      await updateSnippetNote(snippet.id, nextNote || null);
      setOptimisticSavedNote(nextNote);
      setNote(nextNote);
      setEditing(false);
      onDirtyChange(snippet.id, false);
      onMessage("批注已保存。");
    } catch (e) {
      onMessage(`保存批注失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [note, onDirtyChange, onMessage, snippet.id]);

  const cancelEdit = useCallback(async (draftNote = note) => {
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
  }, [confirm, note, onDirtyChange, savedNote, snippet.id]);

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
      onMessage(`复制失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningAction(null);
    }
  }, [flash, onMessage, setRunningAction, snippet.quote]);

  const copyWithCitation = useCallback(async () => {
    if (cardActionRef.current) return;
    const startedAt = Date.now();
    setRunningAction("copy-citation");
    try {
      const ref = await referenceForWork(snippet.work_id, citeStyle).catch(() => "");
      const page = snippet.page_index != null ? `(p. ${snippet.page_index + 1})` : "";
      const note = savedNote.trim() ? `\n\n批注：${savedNote.trim()}` : "";
      const text = ref ? `"${snippet.quote}" ${page}${note}\n\n${ref}` : snippet.quote;
      await writeClipboardText(text);
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      flash("已复制含引文");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onMessage(`复制失败：${e instanceof Error ? e.message : String(e)}`);
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
      await deleteSnippet(snippet.id);
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onMessage("素材已删除。");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_SNIPPET_ACTION_BUSY_MS);
      onMessage(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningAction(null);
    }
  }, [confirm, onMessage, setRunningAction, snippet.id]);

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
            placeholder="加一条批注：为什么有用、适合放在哪个段落、要如何改写..."
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleNoteKeyDown}
          />
          <div className="snippet-card__actions">
            <Button onClick={() => void saveNote()} disabled={saving} aria-busy={saving || undefined}>
              {saving ? "保存中..." : "保存批注"}
            </Button>
            <Button variant="ghost" onClick={() => void cancelEdit()} disabled={saving}>
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
              onClick={() => void copyQuote()}
            >
              {cardAction === "copy" ? "复制中..." : "复制"}
            </button>
            <button
              type="button"
              disabled={cardActionBusy}
              aria-busy={cardAction === "copy-citation" || undefined}
              onClick={() => void copyWithCitation()}
            >
              {cardAction === "copy-citation" ? "生成中..." : "复制+引文"}
            </button>
            <button type="button" disabled={cardActionBusy} onClick={() => setEditing(true)}>
              {savedNote ? "编辑批注" : "加批注"}
            </button>
            <button type="button" disabled={cardActionBusy} onClick={onOpenSource}>
              溯源
            </button>
            <button
              type="button"
              className="snippet-card__delete"
              disabled={cardActionBusy}
              aria-busy={cardAction === "delete-confirm" || cardAction === "delete" || undefined}
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
