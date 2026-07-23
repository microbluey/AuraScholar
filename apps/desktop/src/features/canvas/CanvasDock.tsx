import {
  Books,
  CaretDown,
  CursorClick,
  Hand,
  MagnifyingGlass,
  NotePencil,
  Plus,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { shortcutLabel } from "../../shortcut-labels";
import type { CanvasToolboxPanel } from "./canvas-interactions";

export type CanvasTool = "select" | "pan";

interface CanvasDockProps {
  activePanel: CanvasToolboxPanel | null;
  onAddNote: () => void;
  onOpenCommand: () => void;
  onPanelChange: (panel: CanvasToolboxPanel | null) => void;
  onToolChange: (tool: CanvasTool) => void;
  tool: CanvasTool;
}

type CanvasDockMenu = "create" | "pointer";

function toolClass(active: boolean): string {
  return `canvas-dock__button${active ? " canvas-dock__button--active" : ""}`;
}

export function CanvasDock({
  activePanel,
  onAddNote,
  onOpenCommand,
  onPanelChange,
  onToolChange,
  tool,
}: CanvasDockProps) {
  const [openMenu, setOpenMenu] = useState<CanvasDockMenu | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const PointerIcon = tool === "pan" ? Hand : CursorClick;

  useEffect(() => {
    if (!openMenu) return;
    const frame = window.requestAnimationFrame(() => {
      dockRef.current
        ?.querySelector<HTMLElement>(
          `[data-canvas-dock-menu="${openMenu}"] [role="menuitem"], [data-canvas-dock-menu="${openMenu}"] [role="menuitemradio"]`,
        )
        ?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && dockRef.current?.contains(event.target)) return;
      setOpenMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [openMenu]);

  const toggleMenu = (menu: CanvasDockMenu, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  const runMenuAction = (action: () => void) => {
    setOpenMenu(null);
    action();
  };

  return (
    <div ref={dockRef} className="canvas-dock" role="toolbar" aria-label="空间白板工具栏">
      <button
        className={toolClass(activePanel === "library")}
        type="button"
        data-canvas-toolbox-trigger="library"
        onClick={() => onPanelChange(activePanel === "library" ? null : "library")}
        aria-controls="canvas-toolbox-panel-library"
        aria-expanded={activePanel === "library"}
        aria-label={`${activePanel === "library" ? "收起" : "打开"}文献库`}
        title="文献库"
      >
        <Books size={20} weight="duotone" />
        <span>文献库</span>
      </button>

      <div className="canvas-dock__action">
        <button
          className={toolClass(openMenu === "create")}
          type="button"
          aria-haspopup="menu"
          aria-expanded={openMenu === "create"}
          onClick={(event) => toggleMenu("create", event.currentTarget)}
          title="新建或加入内容"
        >
          <Plus size={20} weight="bold" />
          <span>新建</span>
          <CaretDown className="canvas-dock__caret" size={12} weight="bold" />
        </button>
        {openMenu === "create" && (
          <div
            className="canvas-dock__menu canvas-dock__menu--create"
            data-canvas-dock-menu="create"
            role="menu"
            aria-label="新建或加入内容"
          >
            <button type="button" role="menuitem" onClick={() => runMenuAction(onAddNote)}>
              <NotePencil size={17} weight="duotone" />
              <span>
                <strong>新建研究笔记</strong>
                <small>在画布中央创建想法卡片</small>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenCommand)}>
              <MagnifyingGlass size={17} weight="duotone" />
              <span>
                <strong>搜索并加入文献</strong>
                <small>{shortcutLabel("K")}</small>
              </span>
            </button>
          </div>
        )}
      </div>

      <span className="canvas-dock__divider" aria-hidden="true" />

      <div className="canvas-dock__action">
        <button
          className={toolClass(openMenu === "pointer")}
          type="button"
          aria-haspopup="menu"
          aria-expanded={openMenu === "pointer"}
          onClick={(event) => toggleMenu("pointer", event.currentTarget)}
          title={tool === "select" ? "选择与框选" : "平移画布"}
        >
          <PointerIcon size={20} weight="duotone" />
          <span>{tool === "select" ? "指针" : "平移"}</span>
          <CaretDown className="canvas-dock__caret" size={12} weight="bold" />
        </button>
        {openMenu === "pointer" && (
          <div
            className="canvas-dock__menu canvas-dock__menu--pointer"
            data-canvas-dock-menu="pointer"
            role="menu"
            aria-label="指针工具"
          >
            <button
              className={tool === "select" ? "canvas-dock__menu-item--selected" : undefined}
              type="button"
              role="menuitemradio"
              aria-checked={tool === "select"}
              onClick={() => runMenuAction(() => onToolChange("select"))}
            >
              <CursorClick size={17} weight="duotone" />
              <span>
                <strong>选择</strong>
                <small>单击、多选或框选卡片</small>
              </span>
            </button>
            <button
              className={tool === "pan" ? "canvas-dock__menu-item--selected" : undefined}
              type="button"
              role="menuitemradio"
              aria-checked={tool === "pan"}
              onClick={() => runMenuAction(() => onToolChange("pan"))}
            >
              <Hand size={17} weight="duotone" />
              <span>
                <strong>平移</strong>
                <small>也可按住空格或鼠标中键</small>
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
