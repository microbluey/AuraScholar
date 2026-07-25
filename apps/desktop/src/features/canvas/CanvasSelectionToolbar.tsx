import type { AISynthesisType, CanvasLayoutMode } from "@aurascholar/core";
import {
  BoundingBox,
  CalendarDots,
  CircleNotch,
  DotsThree,
  GridFour,
  Sparkle,
  TreeStructure,
} from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { SYNTHESIS_LABELS } from "./model";

const SYNTHESIS_TYPES = [
  "methodology_matrix",
  "contradiction_analysis",
  "research_gap",
  "tldr",
] as const satisfies readonly AISynthesisType[];

type SelectionMenu = "layout" | "synthesis" | "more";

export interface CanvasSelectionMoreAction {
  danger?: boolean;
  description?: string;
  icon?: ReactNode;
  id: string;
  label: string;
  onSelect: () => void;
}

export interface CanvasSelectionToolbarProps {
  canCitationLayout: boolean;
  citationLayoutBusy: boolean;
  citationLayoutHint: string;
  canGroup: boolean;
  canLayout: boolean;
  canTimelineLayout: boolean;
  canSynthesize: boolean;
  className?: string;
  layoutHint: string;
  moreActions?: readonly CanvasSelectionMoreAction[];
  onGroup: () => void;
  onLayout: (mode: CanvasLayoutMode) => void;
  onSynthesize: (type: AISynthesisType) => void;
  selectedCount: number;
  style?: CSSProperties;
  synthesisHint?: string;
  timelineLayoutHint: string;
}

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export function CanvasSelectionToolbar({
  canCitationLayout,
  citationLayoutBusy,
  citationLayoutHint,
  canGroup,
  canLayout,
  canTimelineLayout,
  canSynthesize,
  className,
  layoutHint,
  moreActions = [],
  onGroup,
  onLayout,
  onSynthesize,
  selectedCount,
  style,
  synthesisHint = "使用所选来源生成 AI 合成卡片",
  timelineLayoutHint,
}: CanvasSelectionToolbarProps) {
  const [openMenu, setOpenMenu] = useState<SelectionMenu | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuIdPrefix = useId();
  const hasMoreActions = moreActions.length > 0;

  useEffect(() => {
    if (!openMenu) return;

    const frame = window.requestAnimationFrame(() => {
      toolbarRef.current
        ?.querySelector<HTMLElement>(
          `[data-selection-menu="${openMenu}"] [role="menuitem"]:not(:disabled)`,
        )
        ?.focus();
    });

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenMenu(null);
      window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return;
      setOpenMenu(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [openMenu]);

  if (selectedCount < 2) return null;

  const toggleMenu = (menu: SelectionMenu, trigger: HTMLButtonElement) => {
    menuTriggerRef.current = trigger;
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const runAction = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <div
      ref={toolbarRef}
      className={joinClassNames("canvas-selection-toolbar", className)}
      role="toolbar"
      aria-label={`已选择 ${selectedCount} 张卡片的操作`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <output className="canvas-selection-toolbar__count" aria-live="polite">
        已选 {selectedCount}
      </output>

      {canGroup && (
        <button
          className="canvas-selection-toolbar__button"
          type="button"
          onClick={onGroup}
          title="将所选卡片编组"
        >
          <BoundingBox size={18} weight="duotone" />
          <span>分组</span>
        </button>
      )}

      <div className="canvas-selection-toolbar__action">
        <button
          className={joinClassNames(
            "canvas-selection-toolbar__button",
            openMenu === "layout" && "canvas-selection-toolbar__button--active",
          )}
          type="button"
          data-canvas-selection-layout-trigger="true"
          aria-haspopup="menu"
          aria-expanded={openMenu === "layout"}
          aria-controls={`${menuIdPrefix}-layout`}
          onClick={(event) => toggleMenu("layout", event.currentTarget)}
          title={canLayout ? "整理所选卡片" : layoutHint}
        >
          <TreeStructure size={18} weight="duotone" />
          <span>整理</span>
        </button>
        {openMenu === "layout" && (
          <div
            id={`${menuIdPrefix}-layout`}
            className="canvas-selection-toolbar__menu canvas-selection-toolbar__menu--layout"
            data-selection-menu="layout"
            role="menu"
            aria-label="选择整理方式"
          >
            <button
              type="button"
              role="menuitem"
              disabled={!canLayout}
              onClick={() => runAction(() => onLayout("compact-grid"))}
            >
              <GridFour size={17} weight="duotone" />
              <span>
                <strong>整齐排列</strong>
                <small>{canLayout ? "按当前阅读顺序收紧为网格" : layoutHint}</small>
              </span>
            </button>
            <div className="canvas-selection-toolbar__menu-section-label" aria-hidden="true">
              文献专用
            </div>
            <button
              type="button"
              role="menuitem"
              disabled={!canTimelineLayout}
              onClick={() => runAction(() => onLayout("timeline"))}
            >
              <CalendarDots size={17} weight="duotone" />
              <span>
                <strong>按发表年份排列</strong>
                <small>{timelineLayoutHint}</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-busy={citationLayoutBusy || undefined}
              disabled={!canCitationLayout || citationLayoutBusy}
              onClick={() => runAction(() => onLayout("citation-tree"))}
            >
              {citationLayoutBusy ? (
                <CircleNotch
                  className="canvas-selection-toolbar__spinner"
                  size={17}
                  weight="bold"
                />
              ) : (
                <TreeStructure size={17} weight="duotone" />
              )}
              <span>
                <strong>{citationLayoutBusy ? "正在读取引文关系…" : "按引用树排列"}</strong>
                <small>{canCitationLayout ? citationLayoutHint : timelineLayoutHint}</small>
              </span>
            </button>
          </div>
        )}
      </div>

      {canSynthesize && (
        <div className="canvas-selection-toolbar__action">
          <button
            className={joinClassNames(
              "canvas-selection-toolbar__button",
              "canvas-selection-toolbar__button--ai",
              openMenu === "synthesis" && "canvas-selection-toolbar__button--active",
            )}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "synthesis"}
            aria-controls={`${menuIdPrefix}-synthesis`}
            onClick={(event) => toggleMenu("synthesis", event.currentTarget)}
            title={synthesisHint}
          >
            <Sparkle size={18} weight="fill" />
            <span>AI 合成</span>
          </button>
          {openMenu === "synthesis" && (
            <div
              id={`${menuIdPrefix}-synthesis`}
              className="canvas-selection-toolbar__menu canvas-selection-toolbar__menu--synthesis"
              data-selection-menu="synthesis"
              role="menu"
              aria-label="选择 AI 合成方式"
            >
              {SYNTHESIS_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  onClick={() => runAction(() => onSynthesize(type))}
                >
                  {SYNTHESIS_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasMoreActions && (
        <div className="canvas-selection-toolbar__action">
          <button
            className={joinClassNames(
              "canvas-selection-toolbar__button",
              "canvas-selection-toolbar__button--icon",
              openMenu === "more" && "canvas-selection-toolbar__button--active",
            )}
            type="button"
            aria-label="更多所选卡片操作"
            aria-haspopup="menu"
            aria-expanded={openMenu === "more"}
            aria-controls={`${menuIdPrefix}-more`}
            onClick={(event) => toggleMenu("more", event.currentTarget)}
            title="更多操作"
          >
            <DotsThree size={20} weight="bold" />
          </button>
          {openMenu === "more" && (
            <div
              id={`${menuIdPrefix}-more`}
              className="canvas-selection-toolbar__menu canvas-selection-toolbar__menu--more"
              data-selection-menu="more"
              role="menu"
              aria-label="更多所选卡片操作"
            >
              {moreActions.map((action) => (
                <button
                  key={action.id}
                  className={
                    action.danger ? "canvas-selection-toolbar__menu-item--danger" : undefined
                  }
                  type="button"
                  role="menuitem"
                  onClick={() => runAction(action.onSelect)}
                >
                  {action.icon}
                  <span>
                    <strong>{action.label}</strong>
                    {action.description && <small>{action.description}</small>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
