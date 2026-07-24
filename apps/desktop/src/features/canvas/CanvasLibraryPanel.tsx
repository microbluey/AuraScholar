import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useMemo, useState, type DragEvent } from "react";
import type { CanvasLibraryWork } from "./model";

export const CANVAS_WORK_DRAG_TYPE = "application/x-aurascholar-work";

interface CanvasLibraryPanelProps {
  addedWorkIds: Set<string>;
  loading: boolean;
  onAddWork: (work: CanvasLibraryWork) => void;
  works: CanvasLibraryWork[];
}

export function CanvasLibraryPanel({
  addedWorkIds,
  loading,
  onAddWork,
  works,
}: CanvasLibraryPanelProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return works;
    return works.filter((work) =>
      [work.title, work.authorNames.join(" "), work.venue || "", String(work.year || "")]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, works]);

  const beginDrag = (event: DragEvent<HTMLDivElement>, work: CanvasLibraryWork) => {
    if (addedWorkIds.has(work.id)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(CANVAS_WORK_DRAG_TYPE, JSON.stringify(work));
    event.dataTransfer.setData("text/plain", work.title);
  };

  return (
    <div className="canvas-library" aria-label="文献库面板">
      <label className="canvas-library__search">
        <MagnifyingGlass size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、作者或期刊"
          aria-label="搜索可添加到画布的文献"
        />
      </label>
      <p className="canvas-library__hint">点击添加或拖到目标位置；也可按 ⌘/Ctrl + K 快速搜索。</p>
      <div className="canvas-library__list">
        {loading ? (
          <p className="canvas-library__empty" role="status">
            正在读取文献库…
          </p>
        ) : filtered.length ? (
          filtered.map((work) => {
            const added = addedWorkIds.has(work.id);
            return (
              <div
                className={`canvas-library__item${added ? " canvas-library__item--added" : ""}`}
                key={work.id}
                draggable={!added}
                onDragStart={(event) => beginDrag(event, work)}
                title={added ? "已在当前画布中" : "拖到画布中添加"}
              >
                <div>
                  <strong>{work.title}</strong>
                  <span>
                    {[work.authorNames[0], work.year, work.venue].filter(Boolean).join(" · ") ||
                      "元数据待补全"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onAddWork(work)}
                  disabled={added}
                  aria-label={added ? `《${work.title}》已在画布` : `添加《${work.title}》到画布`}
                  title={added ? "已添加" : "添加到画布"}
                >
                  <Plus size={16} weight="bold" />
                </button>
              </div>
            );
          })
        ) : (
          <p className="canvas-library__empty">没有匹配的文献。</p>
        )}
      </div>
    </div>
  );
}
