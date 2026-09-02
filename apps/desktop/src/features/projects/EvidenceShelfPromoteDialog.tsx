import type { EvidenceKind } from "@aurascholar/db/repos/evidence";
import { CircleNotch, Database, X } from "@phosphor-icons/react";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@aurascholar/ui";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { describeSafeError } from "../../services/sensitive-text";
import type { EvidenceShelfItem, EvidenceShelfPromotionDraft } from "../../services/evidence-shelf";

const PROMOTION_KINDS: ReadonlyArray<{ kind: EvidenceKind; label: string }> = [
  { kind: "context", label: "背景" },
  { kind: "method", label: "方法" },
  { kind: "data", label: "数据" },
  { kind: "limitation", label: "局限" },
  { kind: "definition", label: "定义" },
];

export interface EvidenceShelfPromoteDialogProps {
  item: EvidenceShelfItem;
  onClose: () => void;
  onSubmit: (draft: EvidenceShelfPromotionDraft) => Promise<void>;
}

/** Small, project-local form used to turn one verified Shelf row into Evidence. */
export function EvidenceShelfPromoteDialog({
  item,
  onClose,
  onSubmit,
}: EvidenceShelfPromoteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>("context");
  const [title, setTitle] = useState("");
  const [noteMd, setNoteMd] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestClose = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    let parsedTags: string[];
    try {
      parsedTags = parseEvidenceShelfTags(tags);
    } catch (cause) {
      setError(describeSafeError(cause));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trimmedNote = noteMd.trim();
      await onSubmit({
        evidenceKind,
        // An empty note means "keep the source annotation note". The DB
        // promotion boundary distinguishes omitted from explicit null.
        ...(trimmedNote ? { noteMd: trimmedNote } : {}),
        tags: parsedTags,
        title: title.trim() || null,
      });
      onClose();
    } catch (cause) {
      if (!isAbortError(cause)) setError(describeSafeError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const payload = item.previewPayload;
  const excerpt = payload.excerpt.trim() || payload.text.trim();
  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <form
        ref={dialogRef}
        aria-busy={submitting}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="library-modal evidence-shelf-promote-modal"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        role="dialog"
        tabIndex={-1}
      >
        <header className="evidence-shelf-promote-modal__header">
          <span aria-hidden="true">
            <Database size={17} weight="duotone" />
          </span>
          <div>
            <h2 id={titleId}>保存为 Evidence</h2>
            <p id={descriptionId}>
              {payload.workTitle || "项目来源"} · 先核验当前修订与内容哈希，再加入“Evidence”。
            </p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            aria-label="取消保存 Evidence"
            disabled={submitting}
            onClick={requestClose}
          >
            <X size={15} weight="bold" />
          </button>
        </header>

        <blockquote className="evidence-shelf-promote-modal__quote">{excerpt}</blockquote>

        <fieldset disabled={submitting} className="evidence-shelf-promote-modal__kinds">
          <legend>证据类型</legend>
          <div role="radiogroup" aria-label="证据类型">
            {PROMOTION_KINDS.map((option, index) => (
              <button
                key={option.kind}
                type="button"
                data-autofocus={index === 0 ? "true" : undefined}
                role="radio"
                aria-checked={evidenceKind === option.kind}
                className={evidenceKind === option.kind ? "is-selected" : undefined}
                onClick={() => setEvidenceKind(option.kind)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="evidence-shelf-promote-modal__field">
          <span>
            标题 <small>可选</small>
          </span>
          <input
            data-autofocus="true"
            type="text"
            value={title}
            maxLength={512}
            placeholder="例如：实验组的主要发现"
            onChange={(event) => setTitle(event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="evidence-shelf-promote-modal__field">
          <span>
            备注 <small>可选，支持 Markdown；留空则保留批注备注</small>
          </span>
          <textarea
            value={noteMd}
            maxLength={64 * 1024}
            rows={3}
            placeholder="补充你的核验笔记或使用场景"
            onChange={(event) => setNoteMd(event.target.value)}
            disabled={submitting}
          />
        </label>

        <label className="evidence-shelf-promote-modal__field">
          <span>
            标签 <small>可选，用逗号分隔</small>
          </span>
          <input
            type="text"
            value={tags}
            maxLength={8_448}
            placeholder="例如：方法, 关键结论"
            onChange={(event) => setTags(event.target.value)}
            disabled={submitting}
          />
        </label>

        {error ? (
          <p className="evidence-shelf-promote-modal__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="evidence-shelf-promote-modal__actions">
          <Button type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              <CircleNotch className="evidence-shelf-promote-modal__spin" size={14} />
            ) : null}
            {submitting ? "核验并保存中…" : "核验并保存"}
          </Button>
          <Button type="button" variant="secondary" onClick={requestClose} disabled={submitting}>
            取消
          </Button>
        </footer>
      </form>
    </div>
  );
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

export function parseEvidenceShelfTags(value: string): string[] {
  const parsed = value
    .split(/[，,\n]/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (parsed.some((tag) => tag.length > 128)) throw new Error("每个标签最多 128 个字符");
  const unique = [...new Set(parsed)];
  if (unique.length > 64) throw new Error("标签最多 64 个");
  return unique;
}
