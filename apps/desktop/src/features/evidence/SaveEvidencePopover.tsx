import type { EvidenceKind } from "@aurascholar/db/repos/evidence";
import type { ReaderEvidenceSelection } from "@aurascholar/reader";
import { Check, CircleNotch, Database, X } from "@phosphor-icons/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { isImeComposing } from "../../keyboard";
import { describeSafeError } from "../../services/sensitive-text";
import {
  buildReaderEvidenceCommand,
  commitReaderEvidence,
  readerEvidenceCaptureGateway,
  type ReaderEvidenceCaptureGateway,
  type ReaderEvidenceCaptureScope,
  type ReaderEvidenceSessionGuard,
  type ReaderEvidenceSource,
} from "./reader-evidence-capture";
import "./save-evidence-popover.css";

const EVIDENCE_KINDS: Array<{ kind: EvidenceKind; label: string }> = [
  { kind: "context", label: "背景" },
  { kind: "method", label: "方法" },
  { kind: "data", label: "数据" },
  { kind: "limitation", label: "局限" },
  { kind: "definition", label: "定义" },
];

export interface SaveEvidencePopoverProps {
  evidenceId: string;
  gateway?: ReaderEvidenceCaptureGateway;
  onCancel: () => void;
  onSaved: (message: string) => void;
  selection: ReaderEvidenceSelection;
  session: ReaderEvidenceSessionGuard;
  source: ReaderEvidenceSource;
}

export function SaveEvidencePopover({
  evidenceId,
  gateway = readerEvidenceCaptureGateway,
  onCancel,
  onSaved,
  selection,
  session,
  source,
}: SaveEvidencePopoverProps) {
  const titleId = useId();
  const [kind, setKind] = useState<EvidenceKind>("context");
  const [projectId, setProjectId] = useState("");
  const [scope, setScope] = useState<ReaderEvidenceCaptureScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const position = useMemo(() => popoverPosition(selection.clientRect), [selection.clientRect]);

  useEffect(() => {
    const controller = linkedAbortController(session.signal);
    void gateway
      .loadScope(controller.signal)
      .then((nextScope) => {
        if (!controller.signal.aborted && session.isCurrent()) setScope(nextScope);
      })
      .catch((cause) => {
        if (!controller.signal.aborted && session.isCurrent()) {
          setError(`研究项目载入失败：${describeSafeError(cause)}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && session.isCurrent()) setLoading(false);
      });
    return () => controller.abort();
  }, [gateway, session]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!scope || busyRef.current || !session.isCurrent() || session.signal.aborted) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const committed = await commitReaderEvidence({
        command: buildReaderEvidenceCommand({
          evidenceId,
          evidenceKind: kind,
          libraryId: scope.libraryId,
          projectId: projectId || null,
          selection,
          source,
        }),
        gateway,
        session,
      });
      if (committed.status === "stale") return;
      onSaved(
        projectId
          ? `已保存为证据，并加入研究项目（第 ${selection.pageIndex + 1} 页）`
          : `已保存为证据（第 ${selection.pageIndex + 1} 页）`,
      );
    } catch (cause) {
      if (!session.signal.aborted && session.isCurrent()) {
        setError(`保存失败，证据草稿仍保留：${describeSafeError(cause)}`);
      }
    } finally {
      busyRef.current = false;
      if (!session.signal.aborted && session.isCurrent()) setBusy(false);
    }
  };

  return (
    <form
      className="save-evidence-popover"
      aria-busy={busy || loading}
      aria-labelledby={titleId}
      role="dialog"
      style={position}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (isImeComposing(event)) return;
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <header className="save-evidence-popover__header">
        <span aria-hidden="true"><Database size={17} weight="duotone" /></span>
        <div>
          <strong id={titleId}>保存为证据</strong>
          <small>{source.workTitle} · 第 {selection.pageIndex + 1} 页</small>
        </div>
        <button type="button" aria-label="取消保存证据" disabled={busy} onClick={onCancel}>
          <X size={15} weight="bold" />
        </button>
      </header>

      <blockquote>{selection.exact}</blockquote>

      <fieldset disabled={busy}>
        <legend>证据类型</legend>
        <div className="save-evidence-popover__kinds">
          {EVIDENCE_KINDS.map((option, index) => (
            <button
              key={option.kind}
              type="button"
              className={kind === option.kind ? "is-selected" : ""}
              aria-pressed={kind === option.kind}
              autoFocus={index === 0}
              onClick={() => setKind(option.kind)}
            >
              {kind === option.kind ? <Check size={12} weight="bold" /> : null}
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="save-evidence-popover__project">
        <span>研究项目 <small>可选</small></span>
        <select
          value={projectId}
          disabled={busy || loading}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">仅存入证据收件箱</option>
          {scope?.projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>

      {error ? <p className="save-evidence-popover__error" role="alert">{error}</p> : null}

      <footer>
        <span>Enter 保存 · Esc 取消</span>
        <button type="submit" disabled={busy || loading || !scope}>
          {busy ? <CircleNotch className="save-evidence-popover__spinner" size={14} /> : null}
          {busy ? "保存中" : "保存证据"}
        </button>
      </footer>
    </form>
  );
}

function popoverPosition(rect: ReaderEvidenceSelection["clientRect"]): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const width = Math.min(340, Math.max(260, viewportWidth - 24));
  const left = Math.max(12, Math.min(viewportWidth - width - 12, rect.x + rect.width / 2 - width / 2));
  const below = rect.y + rect.height + 12;
  const top = below + 360 < viewportHeight ? below : Math.max(12, rect.y - 372);
  return { left, top, width };
}

function linkedAbortController(parent: AbortSignal): AbortController {
  const controller = new AbortController();
  if (parent.aborted) controller.abort(parent.reason);
  else {
    const abort = () => controller.abort(parent.reason);
    parent.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", () => parent.removeEventListener("abort", abort), {
      once: true,
    });
  }
  return controller;
}
