// Import confirmation card. Nothing reaches the library until the user confirms
// here. They choose one of:
//   • an online candidate (title searches can return look-alikes — e.g.
//     "Attention is All you Need" surfacing the unrelated "Is Attention All You
//     Need?" — so the user picks the right one);
//   • an existing library work it matches (attaches the PDF, no new record);
//   • the PDF's own extracted fields (title/authors/year), so "unidentified"
//     isn't reduced to a bare filename;
//   • a hand-edited record.
import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@aurascholar/ui";
import type { NormalizedWork } from "@aurascholar/connectors";
import type { WorkInput, WorkPatch } from "@aurascholar/db";
import type { IngestDraft, LocalMatch, PdfFields, PendingPdf } from "../services/library";
import { toWorkInput } from "../services/library";
import { MetadataEditor, emptyDraft, normalizedWorkToDraft, type Draft } from "./MetadataEditor";

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

  const lowConfidence =
    selection.kind === "online" && draft.bestIndex >= 0 && draft.confidence < 0.7;

  const isOnline = (i: number) => !edited && selection.kind === "online" && selection.index === i;
  const isLocal = (id: string) => !edited && selection.kind === "local" && selection.workId === id;
  const isPdf = !edited && selection.kind === "pdf";
  const isBlank = !edited && selection.kind === "blank";
  // Attaching to an existing work (target or local) — no metadata to author.
  const isAttach = selection.kind === "target" || selection.kind === "local";

  const editorInitial: Draft = useMemo(() => {
    if (edited) return workInputToDraft(edited);
    if (selection.kind === "online") return normalizedWorkToDraft(draft.candidates[selection.index]!);
    if (selection.kind === "pdf" && draft.pdfFields) return pdfFieldsToDraft(draft.pdfFields);
    return { ...emptyDraft(), title: draft.fallbackTitle };
  }, [edited, selection, draft]);

  const confirm = async () => {
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
        decision = { mode: "create", workInput: toWorkInput(draft.candidates[selection.index]!), pdf: draft.pdf };
      } else if (selection.kind === "pdf" && draft.pdfFields) {
        decision = { mode: "create", workInput: pdfFieldsToWorkInput(draft.pdfFields, draft.fallbackTitle), pdf: draft.pdf };
      } else {
        // "Leave unidentified": fallback title only, NO guessed identifier.
        decision = { mode: "create", workInput: { title: draft.fallbackTitle || "未命名文献", type: "article" }, pdf: draft.pdf };
      }
      await onCommit(decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

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

  return (
    <div className="library-modal-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="library-modal library-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="library-modal__head">
          <h2>{draft.targetWorkId ? "确认补充全文" : "确认入库"}</h2>
          <button type="button" className="library-modal__close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <p className="au-text-muted" style={{ fontSize: 13 }}>
          {draft.targetWorkId
            ? "找到的全文将挂到所选文献。请核对是否同一篇;若不对,可改选其他候选或新建。"
            : "确认这篇文献的题录后再入库。可选在线候选、库中已有文献(将把 PDF 挂到它上面)、用 PDF 自身信息,或手动编辑。"}
        </p>
        {lowConfidence && (
          <p style={{ fontSize: 13, color: "var(--au-warn, #b45309)" }}>
            ⚠ 匹配置信度较低,请仔细核对是否为同一篇。
          </p>
        )}

        {/* Find-full-text target */}
        {draft.targetWorkId && (
          <Section title="补充全文到">
            <Option
              active={!edited && selection.kind === "target"}
              onSelect={() => { setEdited(null); setSelection({ kind: "target" }); }}
            >
              <strong style={titleStyle}>{draft.targetTitle ?? "所选文献"}</strong>
              <span style={metaStyle}>把这份 PDF 挂到该文献(不新建记录)</span>
            </Option>
          </Section>
        )}

        {/* Online candidates */}
        {draft.candidates.length > 0 && (
          <Section title="在线检索结果">
            {draft.candidates.map((c, i) => (
              <Option key={candidateKey(c, i)} active={isOnline(i)} onSelect={() => { setEdited(null); setSelection({ kind: "online", index: i }); }}>
                <strong style={titleStyle}>{c.title}</strong>
                <span style={metaStyle}>{candidateMeta(c)}</span>
              </Option>
            ))}
          </Section>
        )}

        {/* Existing library works */}
        {draft.localMatches.length > 0 && (
          <Section title="文献库中已有(选中将把 PDF 挂到该条)">
            {draft.localMatches.map((m) => (
              <Option key={m.workId} active={isLocal(m.workId)} onSelect={() => { setEdited(null); setSelection({ kind: "local", workId: m.workId }); }}>
                <strong style={titleStyle}>{m.title}</strong>
                <span style={metaStyle}>{localMeta(m)}</span>
              </Option>
            ))}
          </Section>
        )}

        {/* PDF-extracted fields + blank fallback */}
        <Section title="其他">
          {draft.pdfFields?.title && (
            <Option active={isPdf} onSelect={() => { setEdited(null); setSelection({ kind: "pdf" }); }}>
              <strong style={titleStyle}>使用 PDF 提取的信息</strong>
              <span style={metaStyle}>{pdfFieldsMeta(draft.pdfFields)}</span>
            </Option>
          )}
          <Option active={isBlank} onSelect={() => { setEdited(null); setSelection({ kind: "blank" }); }}>
            <strong style={titleStyle}>都不对 / 留作未识别</strong>
            <span style={metaStyle}>
              以「{draft.fallbackTitle || "未命名文献"}」入库,不带任何标识符,稍后可补充
            </span>
          </Option>
        </Section>

        {edited && (
          <p style={{ fontSize: 12, marginTop: 10, color: "var(--au-text-muted,#6b7280)" }}>
            已手动编辑:<strong>{edited.title}</strong>
          </p>
        )}

        <div style={{ marginTop: 14, fontSize: 12, color: "var(--au-text-muted,#6b7280)" }}>
          {draft.pdf
            ? `附件:${draft.pdf.fileName} · ${draft.pdf.pageCount} 页 · ${formatBytes(draft.pdf.byteSize)}`
            : "无附件"}
        </div>

        {error && (
          <p style={{ color: "var(--au-danger,#dc2626)", fontSize: 13, marginTop: 10 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button onClick={() => void confirm()} disabled={busy}>
            {busy ? "入库中…" : isAttach && !edited ? "挂到该文献" : "确认入库"}
          </Button>
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy || (isAttach && !edited)}>
            编辑元信息
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--au-text-muted,#6b7280)", margin: "0 0 6px" }}>
        {title}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Option({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label className="import-candidate" style={optionStyle(active)}>
      <input type="radio" name="import-selection" checked={active} onChange={onSelect} style={{ marginTop: 3 }} />
      <span>{children}</span>
    </label>
  );
}

const titleStyle: CSSProperties = { fontSize: 14 };
const metaStyle: CSSProperties = { display: "block", fontSize: 12, color: "var(--au-text-muted,#6b7280)" };

function optionStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
    border: active ? "1px solid var(--au-accent,#2563eb)" : "1px solid var(--au-border,#e5e7eb)",
    background: active ? "var(--au-accent-soft,#eff6ff)" : "transparent",
  };
}

function candidateMeta(c: NormalizedWork): string {
  const authors = c.authors.slice(0, 3).map((a) => a.displayName).join(", ");
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
  return [authors ? authors + more : "", m.year != null ? String(m.year) : "", m.doi ? `DOI ${m.doi}` : ""]
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
    authors: (w.authors ?? []).map((a) => ({ displayName: a.displayName, role: a.role ?? "author" })),
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
