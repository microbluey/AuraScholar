import { Check, CircleNotch, FilePdf, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";
import { isImeComposing } from "../../keyboard";
import type { ResearchProjectService } from "../../services/research-project-service";
import { useProjectSourceSearch } from "./useProjectSourceSearch";

export interface ProjectSourcePickerProps {
  busy: boolean;
  onClose(): void;
  onConfirm(workIds: readonly string[]): Promise<boolean>;
  projectId: string;
  projectName: string;
  service: ResearchProjectService;
}

export function ProjectSourcePicker({
  busy,
  onClose,
  onConfirm,
  projectId,
  projectName,
  service,
}: ProjectSourcePickerProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [input, setInput] = useState("");
  const { snapshot, search, toggle } = useProjectSourceSearch(service, projectId);
  const selectedIds = [...snapshot.selectedIds];

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-project-source-search]",
    onEscape: requestClose,
  });

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void search(input);
      },
      input ? 180 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [input, search]);

  const confirm = async () => {
    if (busy || selectedIds.length === 0) return;
    if (await onConfirm(selectedIds)) onClose();
  };

  return (
    <div className="project-source-picker__overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        className="project-source-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        tabIndex={-1}
      >
        <header className="project-source-picker__header">
          <div>
            <h2 id={titleId}>从文献库添加来源</h2>
            <p id={descriptionId}>选择要加入“{projectName}”的文献；原文仍保留在文献库中。</p>
          </div>
          <button
            type="button"
            className="project-source-picker__close"
            onClick={requestClose}
            disabled={busy}
            aria-label="关闭来源选择器"
          >
            <X size={17} weight="bold" />
          </button>
        </header>

        <label className="project-source-picker__search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <input
            ref={searchInputRef}
            data-project-source-search="true"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              if (event.key === "Enter" && selectedIds.length > 0) {
                event.preventDefault();
                void confirm();
              }
            }}
            placeholder="搜索题名、作者、DOI 或标签"
            aria-label="搜索文献库来源"
            disabled={busy}
          />
          {snapshot.loading && <CircleNotch className="research-project-spin" size={17} />}
        </label>

        <div className="project-source-picker__body" aria-live="polite">
          {snapshot.error ? (
            <div className="project-source-picker__state" role="alert">
              <strong>文献库暂时不可用</strong>
              <p>{snapshot.error}</p>
              <button type="button" onClick={() => void search(input)}>
                重试
              </button>
            </div>
          ) : snapshot.loading && snapshot.results.length === 0 ? (
            <div className="project-source-picker__state" role="status">
              <CircleNotch className="research-project-spin" size={22} />
              <span>正在查找文献…</span>
            </div>
          ) : snapshot.results.length === 0 ? (
            <div className="project-source-picker__state">
              <strong>{input.trim() ? "没有匹配文献" : "文献库还没有可加入的来源"}</strong>
              <p>{input.trim() ? "尝试缩短关键词或改用作者、DOI。" : "请先在文献库中导入论文。"}</p>
            </div>
          ) : (
            <div
              className="project-source-picker__results"
              role="listbox"
              aria-multiselectable="true"
            >
              {snapshot.results.map((work) => {
                const selected = snapshot.selectedIds.has(work.workId);
                return (
                  <button
                    key={work.workId}
                    type="button"
                    role="option"
                    aria-selected={work.inProject || selected}
                    className={
                      work.inProject
                        ? "project-source-picker__result--member"
                        : selected
                          ? "project-source-picker__result--selected"
                          : undefined
                    }
                    disabled={busy || work.inProject}
                    onClick={() => toggle(work, !selected)}
                  >
                    <span className="project-source-picker__check" aria-hidden="true">
                      {work.inProject || selected ? (
                        <Check size={13} weight="bold" />
                      ) : (
                        <Plus size={13} weight="bold" />
                      )}
                    </span>
                    <span className="project-source-picker__result-copy">
                      <strong>{work.title}</strong>
                      <small>
                        {work.authorNames.slice(0, 3).join(", ") || "作者待补充"}
                        {work.year ? ` · ${work.year}` : ""}
                      </small>
                    </span>
                    <span className="project-source-picker__result-meta">
                      {work.inProject ? (
                        <small>已在项目中</small>
                      ) : work.pdfCount > 0 ? (
                        <>
                          <FilePdf size={15} />
                          <small>有全文</small>
                        </>
                      ) : (
                        <small>仅题录</small>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="project-source-picker__footer">
          <span>{selectedIds.length > 0 ? `已选择 ${selectedIds.length} 篇` : "可多选文献"}</span>
          <div>
            <button
              type="button"
              className="project-source-picker__cancel"
              onClick={requestClose}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="project-source-picker__confirm"
              onClick={() => void confirm()}
              disabled={busy || selectedIds.length === 0}
            >
              {busy && <CircleNotch className="research-project-spin" size={15} />}
              加入项目{selectedIds.length > 0 ? ` · ${selectedIds.length}` : ""}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
