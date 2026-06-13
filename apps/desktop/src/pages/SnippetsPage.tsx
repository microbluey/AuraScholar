// Writing snippets workspace: every excerpt collected while reading, grouped by
// source paper. Edit notes, copy for pasting into a manuscript, and jump back
// to the source page (溯源). Closes the read → write loop.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@aurascholar/ui";
import type { SnippetWithWork } from "@aurascholar/db";
import { listAllSnippets, updateSnippetNote, deleteSnippet } from "../services/snippets";

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
  onOpenSource,
}: {
  snippet: SnippetWithWork;
  onOpenSource: () => void;
}) {
  const [note, setNote] = useState(snippet.note_md ?? "");
  const [editing, setEditing] = useState(false);

  const saveNote = useCallback(async () => {
    await updateSnippetNote(snippet.id, note.trim() || null);
    setEditing(false);
  }, [snippet.id, note]);

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
              {snippet.page_index != null ? `第 ${snippet.page_index + 1} 页` : "—"}
            </span>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(snippet.quote)}>
              复制
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
