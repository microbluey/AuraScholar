// Full bibliographic metadata editor — EndNote-style field coverage. Opens as a
// modal over the library; loads the work's complete field set + author list
// (with roles), lets the user correct/complete every field, and saves via
// WorksRepo.update (partial — only edited fields are written).
import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@aurascholar/ui";
import type { WorkPatch, AuthorRole } from "@aurascholar/db";
import { loadWorkMetadata, saveWorkMetadata } from "../services/metadata";

interface AuthorDraft {
  displayName: string;
  role: AuthorRole;
}

interface Draft {
  title: string;
  type: string;
  doi: string;
  year: string;
  publicationDate: string;
  venueName: string;
  volume: string;
  issue: string;
  pages: string;
  edition: string;
  numberOfVolumes: string;
  section: string;
  publisher: string;
  placePublished: string;
  seriesTitle: string;
  shortTitle: string;
  originalTitle: string;
  issn: string;
  isbn: string;
  url: string;
  accessedDate: string;
  language: string;
  callNumber: string;
  accessionNumber: string;
  label: string;
  databaseName: string;
  abstract: string;
  keywords: string;
  authors: AuthorDraft[];
}

const TEXT_FIELDS: Array<{ key: keyof Draft; label: string; group: string }> = [
  { key: "doi", label: "DOI", group: "标识" },
  { key: "url", label: "URL", group: "标识" },
  { key: "issn", label: "ISSN", group: "标识" },
  { key: "isbn", label: "ISBN", group: "标识" },
  { key: "accessionNumber", label: "入藏号 Accession", group: "标识" },
  { key: "callNumber", label: "索书号 Call Number", group: "标识" },
  { key: "venueName", label: "期刊 / 来源 Venue", group: "出版" },
  { key: "volume", label: "卷 Volume", group: "出版" },
  { key: "issue", label: "期 Issue", group: "出版" },
  { key: "pages", label: "页码 Pages", group: "出版" },
  { key: "section", label: "栏目 Section", group: "出版" },
  { key: "edition", label: "版本 Edition", group: "出版" },
  { key: "numberOfVolumes", label: "卷数 # Volumes", group: "出版" },
  { key: "seriesTitle", label: "丛书名 Series", group: "出版" },
  { key: "publisher", label: "出版社 Publisher", group: "出版" },
  { key: "placePublished", label: "出版地 Place", group: "出版" },
  { key: "year", label: "年份 Year", group: "日期" },
  { key: "publicationDate", label: "出版日期 (ISO)", group: "日期" },
  { key: "accessedDate", label: "访问日期 Accessed", group: "日期" },
  { key: "shortTitle", label: "短标题 Short Title", group: "其他" },
  { key: "originalTitle", label: "原始标题 Original", group: "其他" },
  { key: "language", label: "语言 Language", group: "其他" },
  { key: "label", label: "标记 Label", group: "其他" },
  { key: "databaseName", label: "数据库 Database", group: "其他" },
];

const GROUPS = ["出版", "标识", "日期", "其他"] as const;

const ROLES: Array<{ value: AuthorRole; label: string }> = [
  { value: "author", label: "作者" },
  { value: "editor", label: "编者" },
  { value: "translator", label: "译者" },
];

export function MetadataEditor({
  workId,
  onClose,
  onSaved,
}: {
  workId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWorkMetadata(workId)
      .then((m) => {
        if (cancelled || !m) return;
        const w = m.work;
        setDraft({
          title: w.title ?? "",
          type: w.type ?? "article",
          doi: w.doi ?? "",
          year: w.year != null ? String(w.year) : "",
          publicationDate: w.publication_date ?? "",
          venueName: w.venue_name ?? "",
          volume: w.volume ?? "",
          issue: w.issue ?? "",
          pages: w.pages ?? "",
          edition: w.edition ?? "",
          numberOfVolumes: w.number_of_volumes ?? "",
          section: w.section ?? "",
          publisher: w.publisher ?? "",
          placePublished: w.place_published ?? "",
          seriesTitle: w.series_title ?? "",
          shortTitle: w.short_title ?? "",
          originalTitle: w.original_title ?? "",
          issn: w.issn ?? "",
          isbn: w.isbn ?? "",
          url: w.url ?? "",
          accessedDate: w.accessed_date ?? "",
          language: w.language ?? "",
          callNumber: w.call_number ?? "",
          accessionNumber: w.accession_number ?? "",
          label: w.label ?? "",
          databaseName: w.database_name ?? "",
          abstract: w.abstract ?? "",
          keywords: m.keywords.join(", "),
          authors: m.authors.map((a) => ({
            displayName: a.displayName,
            role: (a.role as AuthorRole) ?? "author",
          })),
        });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [workId]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }, []);

  const setAuthor = useCallback((i: number, patch: Partial<AuthorDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      const authors = d.authors.map((a, idx) => (idx === i ? { ...a, ...patch } : a));
      return { ...d, authors };
    });
  }, []);

  const addAuthor = useCallback(() => {
    setDraft((d) => (d ? { ...d, authors: [...d.authors, { displayName: "", role: "author" }] } : d));
  }, []);

  const removeAuthor = useCallback((i: number) => {
    setDraft((d) => (d ? { ...d, authors: d.authors.filter((_, idx) => idx !== i) } : d));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      setError("标题不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    const patch: WorkPatch = {
      title: draft.title.trim(),
      type: draft.type.trim() || "article",
      doi: orNull(draft.doi),
      year: draft.year.trim() ? Number(draft.year.trim()) : null,
      publicationDate: orNull(draft.publicationDate),
      venueName: orNull(draft.venueName),
      volume: orNull(draft.volume),
      issue: orNull(draft.issue),
      pages: orNull(draft.pages),
      edition: orNull(draft.edition),
      numberOfVolumes: orNull(draft.numberOfVolumes),
      section: orNull(draft.section),
      publisher: orNull(draft.publisher),
      placePublished: orNull(draft.placePublished),
      seriesTitle: orNull(draft.seriesTitle),
      shortTitle: orNull(draft.shortTitle),
      originalTitle: orNull(draft.originalTitle),
      issn: orNull(draft.issn),
      isbn: orNull(draft.isbn),
      url: orNull(draft.url),
      accessedDate: orNull(draft.accessedDate),
      language: orNull(draft.language),
      callNumber: orNull(draft.callNumber),
      accessionNumber: orNull(draft.accessionNumber),
      label: orNull(draft.label),
      databaseName: orNull(draft.databaseName),
      abstract: orNull(draft.abstract),
      keywords: draft.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      authors: draft.authors
        .filter((a) => a.displayName.trim())
        .map((a, position) => ({ displayName: a.displayName.trim(), role: a.role, position })),
    };
    try {
      await saveWorkMetadata(workId, patch);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [draft, workId, onSaved, onClose]);

  return (
    <div className="library-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="library-modal library-modal--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="library-modal__head">
          <h2>编辑文献元信息</h2>
          <button type="button" className="library-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {!draft ? (
          <p className="au-text-muted">{error ?? "读取中…"}</p>
        ) : (
          <div className="meta-editor">
            <label className="meta-field meta-field--full">
              <span>标题 Title</span>
              <Input value={draft.title} onChange={(e) => set("title", e.target.value)} />
            </label>
            <label className="meta-field">
              <span>类型 Type</span>
              <select
                className="au-input"
                value={draft.type}
                onChange={(e) => set("type", e.target.value)}
              >
                <option value="article">期刊论文 article</option>
                <option value="conference">会议论文 conference</option>
                <option value="preprint">预印本 preprint</option>
                <option value="book">书 book</option>
                <option value="book-chapter">书章 chapter</option>
                <option value="thesis">学位论文 thesis</option>
                <option value="report">报告 report</option>
                <option value="webpage">网页 webpage</option>
              </select>
            </label>

            {/* Authors / editors / translators */}
            <div className="meta-authors">
              <div className="meta-authors__head">
                <span>作者 / 编者 / 译者</span>
                <button type="button" onClick={addAuthor}>
                  + 添加
                </button>
              </div>
              {draft.authors.length === 0 && (
                <p className="au-text-muted" style={{ fontSize: 12 }}>
                  暂无,点「添加」录入。
                </p>
              )}
              {draft.authors.map((a, i) => (
                <div className="meta-author-row" key={i}>
                  <Input
                    placeholder="姓名(如 Ada Lovelace 或 Lovelace, Ada)"
                    value={a.displayName}
                    onChange={(e) => setAuthor(i, { displayName: e.target.value })}
                  />
                  <select
                    className="au-input"
                    value={a.role}
                    onChange={(e) => setAuthor(i, { role: e.target.value as AuthorRole })}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeAuthor(i)} title="删除">
                    ×
                  </button>
                </div>
              ))}
            </div>

            {GROUPS.map((group) => (
              <div className="meta-group" key={group}>
                <h4 className="meta-group__title">{group}</h4>
                <div className="meta-grid">
                  {TEXT_FIELDS.filter((f) => f.group === group).map((f) => (
                    <label className="meta-field" key={f.key}>
                      <span>{f.label}</span>
                      <Input
                        value={draft[f.key] as string}
                        onChange={(e) => set(f.key, e.target.value as Draft[typeof f.key])}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <label className="meta-field meta-field--full">
              <span>关键词 Keywords(逗号分隔)</span>
              <Input value={draft.keywords} onChange={(e) => set("keywords", e.target.value)} />
            </label>
            <label className="meta-field meta-field--full">
              <span>摘要 Abstract</span>
              <textarea
                className="au-input"
                rows={4}
                value={draft.abstract}
                onChange={(e) => set("abstract", e.target.value)}
              />
            </label>

            {error && <p style={{ color: "var(--color-danger)", fontSize: 13 }}>{error}</p>}
            <div className="meta-editor__actions">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                取消
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
