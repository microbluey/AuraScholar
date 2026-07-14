// Import confirmation card. Nothing reaches the library until the user confirms
// here. They choose one of:
//   • an online candidate (title searches can return look-alikes — e.g.
//     "Attention is All you Need" surfacing the unrelated "Is Attention All You
//     Need?" — so the user picks the right one);
//   • an existing library work it matches (attaches the PDF, no new record);
//   • the PDF's own extracted fields (title/authors/year), so "unidentified"
//     isn't reduced to a bare filename;
//   • a hand-edited record.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@aurascholar/ui";
import type { NormalizedWork } from "@aurascholar/connectors";
import type { WorkInput, WorkPatch } from "@aurascholar/db";
import type { IngestDraft, LocalMatch, PdfFields, PendingPdf } from "../services/library-types";
import { describeSafeError } from "../services/sensitive-text";
import { toWorkInput } from "../services/work-input";
import { MetadataEditor, emptyDraft, normalizedWorkToDraft, type Draft } from "./MetadataEditor";
import { useModalFocusTrap } from "./useModalFocusTrap";

const MIN_IMPORT_CONFIRM_BUSY_MS = 250;

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

/** What the user picked. Drives whether commit creates a new work or attaches. */
type Selection =
  | { kind: "target" } // attach to the work this "find full text" was launched from
  | { kind: "online"; index: number }
  | { kind: "local"; workId: string }
  | { kind: "pdf" }
  | { kind: "blank" }
  | { kind: "edited" };

/** Commit either creates a new work (workInput) or attaches the PDF to an existing one. */
export type ImportDecision =
  | { mode: "create"; workInput: WorkInput; pdf: PendingPdf | null }
  | { mode: "attach"; workId: string; pdf: PendingPdf | null };

export function ImportConfirmDialog({
  draft,
  onCommit,
  onCancel,
}: {
  draft: IngestDraft;
  onCommit: (decision: ImportDecision) => Promise<void>;
  onCancel: () => void;
}) {
  const initialSelection: Selection = draft.targetWorkId
    ? { kind: "target" }
    : draft.bestIndex >= 0
      ? { kind: "online", index: draft.bestIndex }
      : draft.localMatches.length > 0
        ? { kind: "local", workId: draft.localMatches[0]!.workId }
        : draft.pdfFields?.title
          ? { kind: "pdf" }
          : { kind: "blank" };

  const [selection, setSelection] = useState<Selection>(initialSelection);
  // A hand-edited record (from the metadata editor) overrides the selection.
  const [edited, setEdited] = useState<WorkInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const committingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const lowConfidence =
    selection.kind === "online" && draft.bestIndex >= 0 && draft.confidence < 0.7;
  const confidenceLabel = `${Math.round(draft.confidence * 100)}%`;

  const isOnline = (i: number) => !edited && selection.kind === "online" && selection.index === i;
  const isLocal = (id: string) => !edited && selection.kind === "local" && selection.workId === id;
  const isPdf = !edited && selection.kind === "pdf";
  const isBlank = !edited && selection.kind === "blank";
  // Attaching to an existing work (target or local) — no metadata to author.
  const isAttach = selection.kind === "target" || selection.kind === "local";

  const editorInitial: Draft = useMemo(() => {
    if (edited) return workInputToDraft(edited);
    if (selection.kind === "online")
      return normalizedWorkToDraft(draft.candidates[selection.index]!);
    if (selection.kind === "pdf" && draft.pdfFields) return pdfFieldsToDraft(draft.pdfFields);
    return { ...emptyDraft(), title: draft.fallbackTitle };
  }, [edited, selection, draft]);

  const confirm = async () => {
    if (committingRef.current) return;
    committingRef.current = true;
    const startedAt = Date.now();
    setBusy(true);
    setError(null);
    try {
      let decision: ImportDecision;
      if (edited) {
        decision = { mode: "create", workInput: edited, pdf: draft.pdf };
      } else if (selection.kind === "target" && draft.targetWorkId) {
        decision = { mode: "attach", workId: draft.targetWorkId, pdf: draft.pdf };
      } else if (selection.kind === "local") {
        decision = { mode: "attach", workId: selection.workId, pdf: draft.pdf };
      } else if (selection.kind === "online") {
        decision = {
          mode: "create",
          workInput: toWorkInput(draft.candidates[selection.index]!),
          pdf: draft.pdf,
        };
      } else if (selection.kind === "pdf" && draft.pdfFields) {
        decision = {
          mode: "create",
          workInput: pdfFieldsToWorkInput(draft.pdfFields, draft.fallbackTitle),
          pdf: draft.pdf,
        };
      } else {
        // "Leave unidentified": fallback title only, NO guessed identifier.
        decision = {
          mode: "create",
          workInput: { title: draft.fallbackTitle || "未命名文献", type: "article" },
          pdf: draft.pdf,
        };
      }
      await waitForMinimumElapsed(startedAt, MIN_IMPORT_CONFIRM_BUSY_MS);
      await onCommit(decision);
    } catch (e) {
      setError(describeSafeError(e));
      committingRef.current = false;
      setBusy(false);
    }
  };

  const requestCancel = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestCancel,
  });

  if (editing) {
    return (
      <MetadataEditor
        initialDraft={editorInitial}
        onClose={() => setEditing(false)}
        onCommit={(patch: WorkPatch) => {
          setEdited(patchToWorkInput(patch, draft.fallbackTitle));
          setSelection({ kind: "edited" });
          setEditing(false);
        }}
      />
    );
  }

  const primaryBusyLabel = isAttach && !edited ? "挂载中..." : "入库中...";
  const primaryLabel = isAttach && !edited ? "挂到该文献" : "确认入库";
  const closeLabel = draft.targetWorkId ? "关闭确认补充全文" : "关闭确认入库";

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestCancel}>
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-busy={busy}
        aria-modal="true"
        className="library-modal library-modal--wide import-confirm-modal"
        data-modal-root="true"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <Badge variant={draft.targetWorkId ? "neutral" : "accent"}>
              {draft.targetWorkId ? "全文补充" : "待确认"}
            </Badge>
            <h2 id={titleId}>{draft.targetWorkId ? "确认补充全文" : "确认入库"}</h2>
          </div>
          <button
            type="button"
            className="library-modal__close"
            onClick={requestCancel}
            aria-label={closeLabel}
            title={closeLabel}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <p className="import-confirm__intro" id={descriptionId}>
          {draft.targetWorkId
            ? "找到的全文将挂到所选文献。请核对是否同一篇;若不对,可改选其他候选或新建。"
            : "确认这篇文献的题录后再入库。可选在线候选、库中已有文献(将把 PDF 挂到它上面)、用 PDF 自身信息,或手动编辑。"}
        </p>
        {lowConfidence && (
          <div
            className="import-confirm__warning"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <Badge variant="warning">低置信度</Badge>
            <div>
              <strong>候选匹配置信度 {confidenceLabel}</strong>
              <p>标题检索可能返回相似但不同的论文。入库前请核对题名、作者、年份和 DOI。</p>
            </div>
          </div>
        )}

        {/* Find-full-text target */}
        {draft.targetWorkId && (
          <Section title="补充全文到">
            <Option
              active={!edited && selection.kind === "target"}
              disabled={busy}
              onSelect={() => {
                setEdited(null);
                setSelection({ kind: "target" });
              }}
            >
              <strong>{draft.targetTitle ?? "所选文献"}</strong>
              <span>把这份 PDF 挂到该文献(不新建记录)</span>
            </Option>
          </Section>
        )}

        {/* Online candidates */}
        {draft.candidates.length > 0 && (
          <Section title="在线检索结果">
            {draft.candidates.map((c, i) => (
              <Option
                key={candidateKey(c, i)}
                active={isOnline(i)}
                disabled={busy}
                onSelect={() => {
                  setEdited(null);
                  setSelection({ kind: "online", index: i });
                }}
              >
                <strong>{c.title}</strong>
                <span>{candidateMeta(c)}</span>
              </Option>
            ))}
          </Section>
        )}

        {/* Existing library works */}
        {draft.localMatches.length > 0 && (
          <Section title="文献库中已有(选中将把 PDF 挂到该条)">
            {draft.localMatches.map((m) => (
              <Option
                key={m.workId}
                active={isLocal(m.workId)}
                disabled={busy}
                onSelect={() => {
                  setEdited(null);
                  setSelection({ kind: "local", workId: m.workId });
                }}
              >
                <strong>{m.title}</strong>
                <span>{localMeta(m)}</span>
              </Option>
            ))}
          </Section>
        )}

        {/* PDF-extracted fields + blank fallback */}
        <Section title="其他">
          {draft.pdfFields?.title && (
            <Option
              active={isPdf}
              disabled={busy}
              onSelect={() => {
                setEdited(null);
                setSelection({ kind: "pdf" });
              }}
            >
              <strong>使用 PDF 提取的信息</strong>
              <span>{pdfFieldsMeta(draft.pdfFields)}</span>
            </Option>
          )}
          <Option
            active={isBlank}
            disabled={busy}
            onSelect={() => {
              setEdited(null);
              setSelection({ kind: "blank" });
            }}
          >
            <strong>都不对 / 留作未识别</strong>
            <span>以「{draft.fallbackTitle || "未命名文献"}」入库,不带任何标识符,稍后可补充</span>
          </Option>
        </Section>

        {edited && (
          <div className="import-confirm__edited">
            <Badge variant="success">已编辑</Badge>
            <span>
              将以手动编辑后的题录入库：<strong>{edited.title}</strong>
            </span>
          </div>
        )}

        <div className="import-confirm__attachment">
          <Badge variant={draft.pdf ? "success" : "neutral"}>
            {draft.pdf ? "PDF 附件" : "无附件"}
          </Badge>
          <span>
            {draft.pdf
              ? `${draft.pdf.fileName} · ${draft.pdf.pageCount} 页 · ${formatBytes(draft.pdf.byteSize)}`
              : "确认后只创建题录，稍后可以继续补充全文。"}
          </span>
        </div>

        {error && <p className="import-confirm__error">{error}</p>}
        {busy && (
          <p className="import-confirm__status" role="status" aria-live="polite">
            {isAttach && !edited ? "正在挂载 PDF..." : "正在确认入库..."}
          </p>
        )}

        <div className="library-modal-actions import-confirm__actions">
          <Button onClick={() => void confirm()} disabled={busy} aria-busy={busy}>
            {busy ? primaryBusyLabel : primaryLabel}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setEditing(true)}
            disabled={busy || (isAttach && !edited)}
          >
            编辑元信息
          </Button>
          <Button variant="secondary" onClick={requestCancel} disabled={busy}>
            取消
          </Button>
        </div>
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="import-confirm-section">
      <h3>{title}</h3>
      <div className="import-confirm-section__options">{children}</div>
    </section>
  );
}

function Option({
  active,
  disabled = false,
  onSelect,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`import-confirm-option ${active ? "import-confirm-option--active" : ""} ${
        disabled ? "import-confirm-option--disabled" : ""
      }`}
      aria-disabled={disabled}
    >
      <input
        type="radio"
        name="import-selection"
        checked={active}
        disabled={disabled}
        data-autofocus={active ? "true" : undefined}
        onChange={onSelect}
      />
      <span className="import-confirm-option__body">{children}</span>
      <span className="import-confirm-option__status">
        {disabled ? (active ? "处理中" : "锁定") : active ? "已选择" : "选择"}
      </span>
    </label>
  );
}

function candidateMeta(c: NormalizedWork): string {
  const authors = c.authors
    .slice(0, 3)
    .map((a) => a.displayName)
    .join(", ");
  const more = c.authors.length > 3 ? " 等" : "";
  return [
    authors ? authors + more : "",
    c.year != null ? String(c.year) : "",
    c.venueName ?? "",
    c.doi ? `DOI ${c.doi}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function localMeta(m: LocalMatch): string {
  const authors = m.authors.slice(0, 3).join(", ");
  const more = m.authors.length > 3 ? " 等" : "";
  return [
    authors ? authors + more : "",
    m.year != null ? String(m.year) : "",
    m.doi ? `DOI ${m.doi}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function pdfFieldsMeta(f: PdfFields): string {
  const authors = f.authors.slice(0, 3).join(", ");
  const more = f.authors.length > 3 ? " 等" : "";
  return [authors ? authors + more : "", f.year != null ? String(f.year) : "", "来自 PDF"]
    .filter(Boolean)
    .join(" · ");
}

function candidateKey(c: NormalizedWork, i: number): string {
  return c.doi ?? c.arxivId ?? `${c.title}:${i}`;
}

function pdfFieldsToWorkInput(f: PdfFields, fallbackTitle: string): WorkInput {
  return {
    title: f.title?.trim() || fallbackTitle || "未命名文献",
    type: "article",
    year: f.year,
    authors: f.authors.map((displayName, position) => ({ displayName, position })),
  };
}

function pdfFieldsToDraft(f: PdfFields): Draft {
  return {
    ...emptyDraft(),
    title: f.title ?? "",
    year: f.year != null ? String(f.year) : "",
    authors: f.authors.map((displayName) => ({ displayName, role: "author" })),
  };
}

/** Build an editor draft from a WorkInput (a previously-edited override). */
function workInputToDraft(w: WorkInput): Draft {
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
    authors: (w.authors ?? []).map((a) => ({
      displayName: a.displayName,
      role: a.role ?? "author",
    })),
  };
}

/** WorkPatch from the editor → WorkInput for commit (title always present). */
function patchToWorkInput(patch: WorkPatch, fallbackTitle: string): WorkInput {
  const { notesMd: _notesMd, doi, ...rest } = patch;
  return {
    ...rest,
    doi: doi ?? undefined,
    title: patch.title?.trim() || fallbackTitle || "未命名文献",
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
