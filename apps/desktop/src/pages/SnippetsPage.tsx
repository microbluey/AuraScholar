// Writing snippets workspace: every excerpt collected while reading, grouped by
// source paper. Edit notes, copy for pasting into a manuscript, and jump back
// to the source page (溯源). Closes the read → write loop.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@aurascholar/ui";
import type { SnippetWithWork } from "@aurascholar/db";
import { STYLES } from "@aurascholar/cite";
import { listAllSnippets, updateSnippetNote, deleteSnippet } from "../services/snippets";
import { referenceForWork } from "../services/cite";

const STYLE_KEY = "snippet-cite-style";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

interface WorkGroup {
  workId: string;
  workTitle: string;
  items: SnippetWithWork[];
}

export function SnippetsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [citeStyle, setCiteStyle] = useState(
    () => localStorage.getItem(STYLE_KEY) ?? "apa",
  );

  const changeStyle = useCallback((style: string) => {
    setCiteStyle(style);
    localStorage.setItem(STYLE_KEY, style);
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const rows = await listAllSnippets();
    const byWork = new Map<string, WorkGroup>();
    for (const row of rows) {
      const g = byWork.get(row.work_id) ?? {
        workId: row.work_id,
        workTitle: row.work_title,
        items: [],
      };
      g.items.push(row);
      byWork.set(row.work_id, g);
    }
    setGroups([...byWork.values()]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdated = () => void refresh();
    window.addEventListener("aurascholar:snippets-updated", onUpdated);
    return () => window.removeEventListener("aurascholar:snippets-updated", onUpdated);
  }, [refresh]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="snippets-page">
      <p className="app-page-kicker">Writing desk</p>
      <h1 className="app-page-title">写作素材</h1>
      <p className="app-page-subtitle">
        阅读时随手摘录的语料,按文献分组。可加批注、复制到论文、一键溯源回原文。
      </p>

      {total > 0 && (
        <div className="snippets-toolbar">
          <span className="au-text-muted" style={{ fontSize: 12.5 }}>
            引文格式
          </span>
          <select
            className="au-input"
            value={citeStyle}
            onChange={(e) => changeStyle(e.target.value)}
          >
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="au-text-muted" style={{ fontSize: 11.5 }}>
            「复制+引文」会附上该格式的参考文献
          </span>
        </div>
      )}

      {loading ? (
        <p className="au-text-muted">读取中…</p>
      ) : total === 0 ? (
        <div className="library-empty au-surface">
          <h3>还没有写作素材</h3>
          <p className="au-text-muted">
            在阅读器里选中文本,点击工具条上的「✦」即可存为素材,稍后在这里整理。
          </p>
        </div>
      ) : (
        <div className="snippets-groups">
          {groups.map((g) => (
            <section key={g.workId} className="snippets-group au-panel">
              <div className="snippets-group__head">
                <h3 title={g.workTitle}>{g.workTitle}</h3>
                <span className="au-text-muted">{g.items.length} 条</span>
              </div>
              {g.items.map((s) => (
                <SnippetCard
                  key={s.id}
                  snippet={s}
                  citeStyle={citeStyle}
                  onOpenSource={() =>
                    navigate(`/reader?work=${encodeURIComponent(s.work_id)}`)
                  }
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SnippetCard({
  snippet,
  citeStyle,
  onOpenSource,
}: {
  snippet: SnippetWithWork;
  citeStyle: string;
  onOpenSource: () => void;
}) {
  const [note, setNote] = useState(snippet.note_md ?? "");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const saveNote = useCallback(async () => {
    await updateSnippetNote(snippet.id, note.trim() || null);
    setEditing(false);
  }, [snippet.id, note]);

  const flash = useCallback((label: string) => {
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  // Copy the quote plus a formatted reference for the source paper, so the
  // excerpt lands in a manuscript already attributed.
  const copyWithCitation = useCallback(async () => {
    const ref = await referenceForWork(snippet.work_id, citeStyle).catch(() => "");
    const page = snippet.page_index != null ? `(p. ${snippet.page_index + 1})` : "";
    const text = ref ? `"${snippet.quote}" ${page}\n\n${ref}` : snippet.quote;
    await navigator.clipboard?.writeText(text);
    flash("已复制(含引文)");
  }, [snippet, citeStyle, flash]);

  return (
    <article className="snippet-card">
      <blockquote className="snippet-card__quote">{snippet.quote}</blockquote>
      {editing ? (
        <div className="snippet-card__note-edit">
          <textarea
            className="au-input"
            rows={2}
            value={note}
            placeholder="加一条批注(为什么有用、怎么引用…)"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="snippet-card__actions">
            <Button style={{ fontSize: 12 }} onClick={() => void saveNote()}>
              保存
            </Button>
            <Button
              variant="ghost"
              style={{ fontSize: 12 }}
              onClick={() => {
                setNote(snippet.note_md ?? "");
                setEditing(false);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <>
          {snippet.note_md && <p className="snippet-card__note">{snippet.note_md}</p>}
          <div className="snippet-card__actions">
            <span className="au-text-muted snippet-card__meta">
              {copied ?? (snippet.page_index != null ? `第 ${snippet.page_index + 1} 页` : "—")}
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(snippet.quote);
                flash("已复制");
              }}
            >
              复制
            </button>
            <button type="button" onClick={() => void copyWithCitation()}>
              复制+引文
            </button>
            <button type="button" onClick={() => setEditing(true)}>
              {snippet.note_md ? "编辑批注" : "加批注"}
            </button>
            <button type="button" onClick={onOpenSource}>
              溯源
            </button>
            <button
              type="button"
              className="snippet-card__delete"
              onClick={() => void deleteSnippet(snippet.id)}
            >
              删除
            </button>
          </div>
        </>
      )}
    </article>
  );
}
