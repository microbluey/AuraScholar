import type { CanvasNode } from "@aurascholar/core";
import {
  ArrowSquareOut,
  BoundingBox,
  CaretDown,
  CaretRight,
  CornersIn,
  NotePencil,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { CanvasMenuPoint } from "./canvas-interactions";

interface CanvasNodeContextMenuProps {
  canGroupSelection: boolean;
  node: CanvasNode;
  onActivate: (node: CanvasNode) => void;
  onClose: (restoreFocus: boolean) => void;
  onFocusNode: (nodeId: string) => void;
  onGroupSelection: () => void;
  onOpenDetails: (nodeId: string) => void;
  onOpenFullReader: (node: CanvasNode) => void;
  onRemoveNode: (nodeId: string) => void;
  onSetGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  onUngroup: (groupId: string) => void;
  position: CanvasMenuPoint;
}

function MenuAction({
  action,
  children,
  danger = false,
  icon,
  onSelect,
}: {
  action: string;
  children: ReactNode;
  danger?: boolean;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? "canvas-node-menu__danger" : undefined}
      data-canvas-node-action={action}
      onClick={onSelect}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function CanvasNodeContextMenu({
  canGroupSelection,
  node,
  onActivate,
  onClose,
  onFocusNode,
  onGroupSelection,
  onOpenDetails,
  onOpenFullReader,
  onRemoveNode,
  onSetGroupCollapsed,
  onUngroup,
  position,
}: CanvasNodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const readerNode = node.type === "paper" || node.type === "excerpt";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as globalThis.Node | null)) return;
      onClose(false);
    };
    const closeOnViewportChange = () => onClose(false);
    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("blur", closeOnViewportChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("blur", closeOnViewportChange);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    onClose(false);
    action();
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        [],
    );
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + items.length) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    } else if (event.key === "Tab") {
      onClose(false);
      return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[nextIndex]?.focus();
  };

  return (
    <div
      ref={menuRef}
      className="canvas-node-menu nodrag nopan nowheel"
      role="menu"
      aria-label="卡片操作"
      data-canvas-node-menu-for={node.id}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={moveFocus}
    >
      {readerNode ? (
        <>
          <MenuAction
            action="open"
            icon={<ArrowSquareOut size={17} weight="duotone" />}
            onSelect={() => run(() => onActivate(node))}
          >
            {node.type === "excerpt" ? "在同屏阅读器中定位" : "在同屏阅读器中打开"}
          </MenuAction>
          <MenuAction
            action="open-full"
            icon={<CornersIn size={17} weight="duotone" />}
            onSelect={() => run(() => onOpenFullReader(node))}
          >
            在完整阅读器中打开
          </MenuAction>
          <MenuAction
            action="details"
            icon={<NotePencil size={17} weight="duotone" />}
            onSelect={() => run(() => onOpenDetails(node.id))}
          >
            {node.type === "excerpt" ? "编辑摘录边注" : "查看文献信息"}
          </MenuAction>
        </>
      ) : (
        <MenuAction
          action="edit"
          icon={<NotePencil size={17} weight="duotone" />}
          onSelect={() => run(() => onOpenDetails(node.id))}
        >
          {node.type === "group" ? "编辑分组" : "打开编辑页"}
        </MenuAction>
      )}

      {canGroupSelection && (
        <MenuAction
          action="group"
          icon={<BoundingBox size={17} weight="duotone" />}
          onSelect={() => run(onGroupSelection)}
        >
          将所选卡片编组
        </MenuAction>
      )}

      {node.type === "group" && (
        <>
          <MenuAction
            action={node.data.collapsed ? "expand" : "collapse"}
            icon={
              node.data.collapsed ? (
                <CaretRight size={17} weight="bold" />
              ) : (
                <CaretDown size={17} weight="bold" />
              )
            }
            onSelect={() => run(() => onSetGroupCollapsed(node.id, node.data.collapsed !== true))}
          >
            {node.data.collapsed ? "展开分组" : "折叠分组"}
          </MenuAction>
          <MenuAction
            action="ungroup"
            icon={<BoundingBox size={17} weight="duotone" />}
            onSelect={() => run(() => onUngroup(node.id))}
          >
            解除分组并保留卡片
          </MenuAction>
        </>
      )}

      <div className="canvas-node-menu__separator" role="separator" />
      <MenuAction
        action="focus"
        icon={<CornersIn size={17} weight="duotone" />}
        onSelect={() => run(() => onFocusNode(node.id))}
      >
        聚焦这张卡片
      </MenuAction>
      {node.type !== "group" && (
        <MenuAction
          action="remove"
          danger
          icon={<Trash size={17} weight="duotone" />}
          onSelect={() => run(() => onRemoveNode(node.id))}
        >
          仅从画布移除
        </MenuAction>
      )}
    </div>
  );
}
