import { X } from "@phosphor-icons/react";
import { useViewport } from "@xyflow/react";
import { useEffect, useRef, type CSSProperties } from "react";
import {
  QUICK_SEMANTIC_RELATIONS,
  resolveSemanticLinkShortcut,
  type PendingSemanticLink,
  type QuickSemanticRelation,
} from "./semantic-link";

interface SemanticLinkMenuProps {
  onCancel: () => void;
  onSelect: (relationType: QuickSemanticRelation) => void;
  pending: PendingSemanticLink;
  returnFocusElement: HTMLElement | null;
  sourceLabel: string;
  targetLabel: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

export function SemanticLinkMenu({
  onCancel,
  onSelect,
  pending,
  returnFocusElement,
  sourceLabel,
  targetLabel,
}: SemanticLinkMenuProps) {
  const menuRef = useRef<HTMLElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnUnmountRef = useRef(true);
  const viewport = useViewport();

  useEffect(() => {
    firstOptionRef.current?.focus({ preventScroll: true });
    return () => {
      if (restoreFocusOnUnmountRef.current && returnFocusElement?.isConnected) {
        returnFocusElement.focus({ preventScroll: true });
      }
    };
  }, [returnFocusElement]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      const relation = resolveSemanticLinkShortcut({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
        isComposing: event.isComposing,
        targetIsEditable: isEditableTarget(event.target),
      });
      if (!relation) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(relation);
    };
    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, [onCancel, onSelect]);

  useEffect(() => {
    const cancelOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      restoreFocusOnUnmountRef.current = false;
      onCancel();
    };
    window.addEventListener("pointerdown", cancelOnOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", cancelOnOutsidePointer, true);
  }, [onCancel]);

  return (
    <aside
      ref={menuRef}
      className="canvas-semantic-link-menu nodrag nopan nowheel"
      role="dialog"
      aria-label={`选择从“${sourceLabel}”到“${targetLabel}”的关系`}
      aria-describedby="canvas-semantic-link-hint"
      style={
        {
          "--canvas-semantic-link-x": `${pending.position.x * viewport.zoom + viewport.x}px`,
          "--canvas-semantic-link-y": `${pending.position.y * viewport.zoom + viewport.y}px`,
        } as CSSProperties
      }
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        restoreFocusOnUnmountRef.current = false;
        onCancel();
      }}
      data-source-id={pending.sourceId}
      data-target-id={pending.targetId}
    >
      <header className="canvas-semantic-link-menu__header">
        <div>
          <strong>选择关系</strong>
          <span title={`${sourceLabel} → ${targetLabel}`}>
            {sourceLabel} → {targetLabel}
          </span>
        </div>
        <button
          className="canvas-semantic-link-menu__close"
          type="button"
          onClick={onCancel}
          aria-label="取消连线"
          title="取消连线（Esc）"
        >
          <X size={15} weight="bold" />
        </button>
      </header>
      <div className="canvas-semantic-link-menu__options">
        {QUICK_SEMANTIC_RELATIONS.map((option, index) => (
          <button
            key={option.relationType}
            ref={index === 0 ? firstOptionRef : undefined}
            className={`canvas-semantic-link-menu__option canvas-semantic-link-menu__option--${option.relationType}`}
            type="button"
            onClick={() => onSelect(option.relationType)}
            aria-label={`${option.shortcut}，${option.englishLabel}，${option.label}`}
            aria-keyshortcuts={option.shortcut}
          >
            <kbd>{option.shortcut}</kbd>
            <span>{option.englishLabel}</span>
            <strong>{option.label}</strong>
          </button>
        ))}
      </div>
      <small id="canvas-semantic-link-hint">点击选项或按数字键 1–4 · Esc 取消</small>
    </aside>
  );
}
