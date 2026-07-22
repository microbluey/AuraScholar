import type { AISynthesisType } from "@aurascholar/core";
import {
  BoundingBox,
  CornersOut,
  CursorClick,
  Hand,
  Link,
  Minus,
  NotePencil,
  Plus,
  Sparkle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { SYNTHESIS_LABELS } from "./model";

export type CanvasTool = "select" | "pan" | "connect";

interface CanvasDockProps {
  canGroup: boolean;
  canSynthesize: boolean;
  onAddNote: () => void;
  onFitView: () => void;
  onGroup: () => void;
  onSynthesize: (type: AISynthesisType) => void;
  onToolChange: (tool: CanvasTool) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  selectedCount: number;
  synthesisHint: string;
  tool: CanvasTool;
}

function toolClass(active: boolean): string {
  return `canvas-dock__button${active ? " canvas-dock__button--active" : ""}`;
}

export function CanvasDock({
  canGroup,
  canSynthesize,
  onAddNote,
  onFitView,
  onGroup,
  onSynthesize,
  onToolChange,
  onZoomIn,
  onZoomOut,
  selectedCount,
  synthesisHint,
  tool,
}: CanvasDockProps) {
  const [synthesisOpen, setSynthesisOpen] = useState(false);

  useEffect(() => {
    if (!synthesisOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSynthesisOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [synthesisOpen]);

  return (
    <div className="canvas-dock" role="toolbar" aria-label="空间白板工具栏">
      <div className="canvas-dock__segment">
        <button
          className={toolClass(tool === "select")}
          type="button"
          onClick={() => onToolChange("select")}
          aria-pressed={tool === "select"}
          title="选择与框选（Shift 多选）"
        >
          <CursorClick size={20} weight="duotone" />
          <span>选择</span>
        </button>
        <button
          className={toolClass(tool === "pan")}
          type="button"
          onClick={() => onToolChange("pan")}
          aria-pressed={tool === "pan"}
          title="平移画布"
        >
          <Hand size={20} weight="duotone" />
          <span>平移</span>
        </button>
      </div>

      <div className="canvas-dock__segment canvas-dock__segment--compact">
        <button
          className="canvas-dock__icon-button"
          type="button"
          onClick={onZoomOut}
          title="缩小"
          aria-label="缩小画布"
        >
          <Minus size={18} weight="bold" />
        </button>
        <button
          className="canvas-dock__icon-button"
          type="button"
          onClick={onZoomIn}
          title="放大"
          aria-label="放大画布"
        >
          <Plus size={18} weight="bold" />
        </button>
        <button
          className="canvas-dock__icon-button"
          type="button"
          onClick={onFitView}
          title="适配全部卡片"
          aria-label="适配全部卡片"
        >
          <CornersOut size={18} weight="duotone" />
        </button>
      </div>

      <button
        className="canvas-dock__button"
        type="button"
        onClick={onAddNote}
        title="新建研究笔记"
      >
        <NotePencil size={20} weight="duotone" />
        <span>新建笔记</span>
      </button>
      <button
        className="canvas-dock__button"
        type="button"
        onClick={onGroup}
        disabled={!canGroup}
        title={canGroup ? "将所选卡片编组" : "选择至少两张未分组卡片"}
      >
        <BoundingBox size={20} weight="duotone" />
        <span>分组</span>
      </button>
      <button
        className={toolClass(tool === "connect")}
        type="button"
        onClick={() => onToolChange(tool === "connect" ? "select" : "connect")}
        aria-pressed={tool === "connect"}
        title="拖动卡片连接点建立关系"
      >
        <Link size={20} weight="duotone" />
        <span>连接</span>
      </button>

      <div className="canvas-dock__synthesis">
        <button
          className="canvas-dock__button canvas-dock__button--ai"
          type="button"
          onClick={() => setSynthesisOpen((open) => !open)}
          disabled={!canSynthesize}
          aria-expanded={synthesisOpen}
          title={synthesisHint}
        >
          <Sparkle size={20} weight="fill" />
          <span>AI 合成</span>
        </button>
        {synthesisOpen && canSynthesize && (
          <div className="canvas-dock__menu" role="menu" aria-label="选择合成方式">
            {(
              ["methodology_matrix", "contradiction_analysis", "research_gap", "tldr"] as const
            ).map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                onClick={() => {
                  setSynthesisOpen(false);
                  onSynthesize(type);
                }}
              >
                {SYNTHESIS_LABELS[type]}
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedCount > 0 && <span className="canvas-dock__selection">已选 {selectedCount}</span>}
    </div>
  );
}
