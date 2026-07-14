// Full bibliographic metadata editor — EndNote-style field coverage. Opens as a
// modal over the library; loads the work's complete field set + author list
// (with roles), lets the user correct/complete every field, and saves via
// WorksRepo.update (partial — only edited fields are written).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { Badge, Button, Input } from "@aurascholar/ui";
import type { WorkPatch, AuthorRole } from "@aurascholar/db";
import type { NormalizedWork } from "@aurascholar/connectors";
import { loadWorkMetadata, saveWorkMetadata } from "../services/metadata";
import { describeSafeError } from "../services/sensitive-text";
import { useConfirmDialog, type ConfirmFunction } from "./ConfirmDialog";
import { useModalFocusTrap } from "./useModalFocusTrap";

interface AuthorDraft {
  displayName: string;
  role: AuthorRole;
}

export interface Draft {
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

export function emptyDraft(): Draft {
  return {
    title: "",
    type: "article",
    doi: "",
    year: "",
    publicationDate: "",
    venueName: "",
    volume: "",
    issue: "",
    pages: "",
    edition: "",
    numberOfVolumes: "",
    section: "",
    publisher: "",
    placePublished: "",
    seriesTitle: "",
    shortTitle: "",
    originalTitle: "",
    issn: "",
    isbn: "",
    url: "",
    accessedDate: "",
    language: "",
    callNumber: "",
    accessionNumber: "",
    label: "",
    databaseName: "",
    abstract: "",
    keywords: "",
    authors: [],
  };
}

/** Build an editor draft from a resolved candidate (not-yet-ingested work). */
export function normalizedWorkToDraft(w: NormalizedWork): Draft {
  return {
    ...emptyDraft(),
    title: w.title ?? "",
    type: w.type ?? "article",
    doi: w.doi ?? "",
    year: w.year != null ? String(w.year) : "",
    publicationDate: w.publicationDate ?? "",
    venueName: w.venueName ?? "",
    volume: w.volume ?? "",
    issue: w.issue ?? "",
    pages: w.pages ?? "",
    publisher: w.publisher ?? "",
    placePublished: w.placePublished ?? "",
    issn: w.issn ?? "",
    isbn: w.isbn ?? "",
    url: w.url ?? "",
    language: w.language ?? "",
    abstract: w.abstract ?? "",
    keywords: (w.keywords ?? []).join(", "),
    authors: w.authors.map((a) => ({
      displayName: a.displayName,
      role: (a.role as AuthorRole) ?? "author",
    })),
  };
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
const MIN_METADATA_SAVE_BUSY_MS = 250;

interface MetadataSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__?: string;
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

async function waitForNextRenderFrame(): Promise<void> {
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

function consumeMetadataSmokeSaveFailure(): string | null {
  const smokeWindow = window as MetadataSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_METADATA_FAIL_NEXT_SAVE__;
  return message;
}

function formatMetadataSaveError(error: unknown): string {
  const message = describeSafeError(error);
  return `保存失败，修改仍保留：${message}`;
}

export function MetadataEditor({
  workId,
  initialDraft,
  onClose,
  onSaved,
  onCommit,
}: {
  /** Edit an existing library work. Omit for draft (pre-ingest) mode. */
  workId?: string;
  /** Draft-mode initial values (used when workId is absent). */
  initialDraft?: Draft;
  onClose: () => void;
  /** Called after saving an existing work (workId mode). */
  onSaved?: () => void;
  /** Draft mode: receives the edited patch instead of writing to the DB. */
  onCommit?: (patch: WorkPatch) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(workId ? null : (initialDraft ?? emptyDraft()));
  const [savedDraft, setSavedDraft] = useState<Draft | null>(
    workId ? null : (initialDraft ?? emptyDraft()),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const modalRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const titleId = useId();

  const hasUnsavedChanges = useMemo(
    () => Boolean(draft && savedDraft && !sameDraft(draft, savedDraft)),
    [draft, savedDraft],
  );

  useEffect(() => {
    if (!workId) return; // draft mode: initialized from initialDraft, no DB load
    let cancelled = false;
    void loadWorkMetadata(workId)
      .then((m) => {
        if (cancelled || !m) return;
        const w = m.work;
        const nextDraft = {
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
        };
        setDraft(nextDraft);
        setSavedDraft(nextDraft);
      })
      .catch((e) => !cancelled && setError(describeSafeError(e)));
    return () => {
      cancelled = true;
    };
  }, [workId]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError(null);
    setNotice(null);
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }, []);

  const setAuthor = useCallback((i: number, patch: Partial<AuthorDraft>) => {
    setError(null);
    setNotice(null);
    setDraft((d) => {
      if (!d) return d;
      const authors = d.authors.map((a, idx) => (idx === i ? { ...a, ...patch } : a));
      return { ...d, authors };
    });
  }, []);

  const addAuthor = useCallback(() => {
    setError(null);
    setNotice(null);
    setDraft((d) =>
      d ? { ...d, authors: [...d.authors, { displayName: "", role: "author" }] } : d,
    );
  }, []);

  const removeAuthor = useCallback((i: number) => {
    setError(null);
    setNotice(null);
    setDraft((d) => (d ? { ...d, authors: d.authors.filter((_, idx) => idx !== i) } : d));
  }, []);

  const requestClose = useCallback(async () => {
    if (saving) return;
    if (hasUnsavedChanges) {
      const confirmed = await confirm({
        cancelLabel: "继续编辑",
        confirmLabel: "放弃修改",
        description: "这份题录里还有尚未保存的修改。",
        details: ["放弃后会恢复到打开编辑器前的元数据。"],
        eyebrow: "未保存",
        title: "放弃元数据修改吗？",
        tone: "warning",
      });
      if (!confirmed) {
        setNotice("已继续编辑，未保存修改仍在。");
        return;
      }
    }
    onClose();
  }, [confirm, hasUnsavedChanges, onClose, saving]);

  useModalFocusTrap(modalRef, {
    active: Boolean(draft),
    initialFocusSelector: "[data-autofocus]",
    onEscape: () => {
      void requestClose();
    },
  });

  const save = useCallback(async () => {
    if (!draft || savingRef.current) return;
    const validationError = validateDraftForSave(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const startedAt = Date.now();
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    const year = parseDraftYear(draft.year);
    const patch: WorkPatch = {
      title: draft.title.trim(),
      type: draft.type.trim() || "article",
      doi: orNull(draft.doi),
      year,
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
      await waitForNextRenderFrame();
      const smokeFailure = consumeMetadataSmokeSaveFailure();
      if (smokeFailure) throw new Error(smokeFailure);
      if (workId) {
        await saveWorkMetadata(workId, patch);
        await waitForMinimumElapsed(startedAt, MIN_METADATA_SAVE_BUSY_MS);
        setSavedDraft(draft);
        onSaved?.();
      } else {
        await waitForMinimumElapsed(startedAt, MIN_METADATA_SAVE_BUSY_MS);
        setSavedDraft(draft);
        onCommit?.(patch);
      }
      onClose();
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_METADATA_SAVE_BUSY_MS);
      setError(formatMetadataSaveError(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, workId, onSaved, onCommit, onClose]);

  return (
    <>
      {hasUnsavedChanges && <MetadataNavigationGuard confirm={confirm} />}
      <div
        className="library-modal-overlay"
        role="presentation"
        onMouseDown={() => void requestClose()}
      >
        <section
          ref={modalRef}
          aria-labelledby={titleId}
          aria-busy={saving || undefined}
          aria-modal="true"
          className="library-modal library-modal--wide"
          data-modal-root="true"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          tabIndex={-1}
        >
          <div className="library-modal__head">
            <div>
              <h2 id={titleId}>编辑文献元信息</h2>
              {draft && (
                <p className="library-modal__subhead">
                  {hasUnsavedChanges ? "有修改尚未保存。" : "当前题录已同步到打开时的版本。"}
                </p>
              )}
            </div>
            {draft && (
              <Badge variant={hasUnsavedChanges ? "warning" : "neutral"}>
                {hasUnsavedChanges ? "未保存" : "已同步"}
              </Badge>
            )}
            <button
              type="button"
              className="library-modal__close"
              onClick={() => void requestClose()}
              aria-label="关闭编辑文献元信息"
              title="关闭编辑文献元信息"
              disabled={saving}
            >
              ×
            </button>
          </div>

          {!draft ? (
            <p className="au-text-muted">{error ?? "读取中…"}</p>
          ) : (
            <div className="meta-editor">
              {hasUnsavedChanges && (
                <div className="meta-editor__draft-banner" role="status" aria-live="polite">
                  <Badge variant="warning">未保存</Badge>
                  <div>
                    <strong>题录修改尚未保存</strong>
                    <p>保存后，新的作者、摘要和标识符才会进入检索、引用和同步流程。</p>
                  </div>
                </div>
              )}
              <label className="meta-field meta-field--full">
                <span>标题 Title</span>
                <Input
                  data-autofocus="true"
                  value={draft.title}
                  disabled={saving}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <label className="meta-field">
                <span>类型 Type</span>
                <select
                  className="au-input"
                  value={draft.type}
                  disabled={saving}
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
                  <button
                    type="button"
                    onClick={addAuthor}
                    disabled={saving}
                    aria-label="添加作者、编者或译者"
                    title="添加作者、编者或译者"
                  >
                    + 添加
                  </button>
                </div>
                {draft.authors.length === 0 && (
                  <p className="au-text-muted" style={{ fontSize: 12 }}>
                    暂无，点「添加」录入。
                  </p>
                )}
                {draft.authors.map((a, i) => {
                  const authorLabel = a.displayName.trim() || `第 ${i + 1} 位作者`;
                  return (
                    <div
                      className="meta-author-row"
                      key={i}
                      role="group"
                      aria-label={`${authorLabel} 信息`}
                    >
                      <Input
                        placeholder="姓名(如 Ada Lovelace 或 Lovelace, Ada)"
                        value={a.displayName}
                        disabled={saving}
                        aria-label={`${authorLabel} 姓名`}
                        onChange={(e) => setAuthor(i, { displayName: e.target.value })}
                      />
                      <select
                        className="au-input"
                        value={a.role}
                        disabled={saving}
                        aria-label={`${authorLabel} 角色`}
                        onChange={(e) => setAuthor(i, { role: e.target.value as AuthorRole })}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeAuthor(i)}
                        aria-label={`删除作者 ${authorLabel}`}
                        title={`删除作者 ${authorLabel}`}
                        disabled={saving}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
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
                          disabled={saving}
                          onChange={(e) => set(f.key, e.target.value as Draft[typeof f.key])}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <label className="meta-field meta-field--full">
                <span>关键词 Keywords(逗号分隔)</span>
                <Input
                  value={draft.keywords}
                  disabled={saving}
                  onChange={(e) => set("keywords", e.target.value)}
                />
              </label>
              <label className="meta-field meta-field--full">
                <span>摘要 Abstract</span>
                <textarea
                  className="au-input"
                  rows={4}
                  value={draft.abstract}
                  disabled={saving}
                  onChange={(e) => set("abstract", e.target.value)}
                />
              </label>

              {error && (
                <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13 }}>
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>
                  {notice}
                </p>
              )}
              <div className="meta-editor__actions">
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  aria-busy={saving || undefined}
                >
                  {saving ? "保存中…" : "保存"}
                </Button>
                <Button variant="secondary" onClick={() => void requestClose()} disabled={saving}>
                  取消
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      {confirmDialog}
    </>
  );
}

function MetadataNavigationGuard({ confirm }: { confirm: ConfirmFunction }) {
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
      cancelLabel: "继续编辑",
      confirmLabel: "离开页面",
      description: "离开编辑器会丢失尚未保存的题录修改。",
      details: ["保存后，新的题录会用于检索、引用、写作素材和同步。"],
      eyebrow: "未保存",
      title: "要离开元数据编辑器吗？",
      tone: "warning",
    }).then((confirmed) => {
      blockerDialogOpenRef.current = false;
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
  }, [blocker, confirm]);

  return null;
}

function parseDraftYear(value: string): number | null {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function validateDraftForSave(draft: Draft): string | null {
  if (!draft.title.trim()) return "标题不能为空";
  const year = draft.year.trim();
  if (year && !/^\d{4}$/.test(year)) return "年份必须是四位数字，例如 2026。";
  return null;
}

function normalizeDraft(draft: Draft): Draft {
  return {
    ...draft,
    authors: draft.authors.map((author) => ({
      displayName: author.displayName,
      role: author.role,
    })),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(normalizeDraft(a)) === JSON.stringify(normalizeDraft(b));
}
