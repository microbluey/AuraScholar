import { Check, CircleNotch, FolderSimplePlus, X } from "@phosphor-icons/react";
import { Button } from "@aurascholar/ui";
import { useId, useMemo, useRef, useState } from "react";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import type { EvidenceProjectOption } from "./evidence-inbox-service";

export function EvidenceProjectPicker({
  busy,
  item,
  onCancel,
  onConfirm,
  projects,
}: {
  busy: boolean;
  item: EvidenceInboxItemDto | null;
  onCancel: () => void;
  onConfirm: (projectId: string) => Promise<boolean>;
  projects: readonly EvidenceProjectOption[];
}) {
  return item ? (
    <EvidenceProjectPickerDialog
      busy={busy}
      item={item}
      onCancel={onCancel}
      onConfirm={onConfirm}
      projects={projects}
    />
  ) : null;
}

function EvidenceProjectPickerDialog({
  busy,
  item,
  onCancel,
  onConfirm,
  projects,
}: {
  busy: boolean;
  item: EvidenceInboxItemDto;
  onCancel: () => void;
  onConfirm: (projectId: string) => Promise<boolean>;
  projects: readonly EvidenceProjectOption[];
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const available = useMemo(() => {
    const assigned = new Set(item.projectMemberships.map((membership) => membership.projectId));
    return projects.filter((project) => !assigned.has(project.id));
  }, [item.projectMemberships, projects]);
  const [selectedId, setSelectedId] = useState(available[0]?.id ?? "");
  const [error, setError] = useState("");
  const effectiveSelectedId = available.some((project) => project.id === selectedId)
    ? selectedId
    : (available[0]?.id ?? "");

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-evidence-project-option='true']",
    onEscape: () => {
      if (!busy) onCancel();
    },
  });

  const submit = async () => {
    if (!effectiveSelectedId || busy) return;
    setError("");
    const committed = await onConfirm(effectiveSelectedId);
    if (committed) onCancel();
    else setError("加入研究项目失败，请检查来源是否属于该项目后重试。");
  };

  return (
    <div
      className="evidence-project-picker__overlay"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="evidence-project-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        data-modal-root="true"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span aria-hidden="true">
            <FolderSimplePlus size={21} weight="duotone" />
          </span>
          <div>
            <p>Research Project</p>
            <h2 id={titleId}>归档到研究项目</h2>
            <small id={descriptionId}>Evidence 仍保留在 Library，只新增可恢复的项目归属。</small>
          </div>
          <button type="button" aria-label="关闭项目选择器" disabled={busy} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        {available.length > 0 ? (
          <div
            className="evidence-project-picker__list"
            role="radiogroup"
            aria-label="目标研究项目"
          >
            {available.map((project) => {
              const selected = project.id === effectiveSelectedId;
              return (
                <button
                  key={project.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? "is-selected" : ""}
                  data-evidence-project-option="true"
                  disabled={busy}
                  onClick={() => setSelectedId(project.id)}
                  onDoubleClick={() => {
                    setSelectedId(project.id);
                    void onConfirm(project.id).then((committed) => {
                      if (committed) onCancel();
                    });
                  }}
                >
                  <span>{selected ? <Check size={13} weight="bold" /> : null}</span>
                  <strong>{project.name}</strong>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="evidence-project-picker__empty">
            <Check size={22} weight="duotone" aria-hidden="true" />
            <strong>已归档到所有现有项目</strong>
            <span>可在“研究项目”中新建项目后再回来归档。</span>
          </div>
        )}

        {error ? (
          <p className="evidence-project-picker__error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !effectiveSelectedId}
            onClick={() => void submit()}
          >
            {busy ? <CircleNotch className="evidence-spin" size={15} /> : null}
            确认归档
          </Button>
        </footer>
      </section>
    </div>
  );
}
