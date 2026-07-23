import type { CanvasPoint, CanvasWorkspaceDocument } from "@aurascholar/core";
import {
  Article,
  BoundingBox,
  Lightbulb,
  MagnifyingGlass,
  Quotes,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { useViewport } from "@xyflow/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { buildCanvasLinkTargetOptions, type CanvasLinkTargetOption } from "./canvas-link-target";

export interface CanvasLinkTargetRequest {
  position: CanvasPoint;
  sourceHandle?: string;
  sourceId: string;
  workspaceId: string;
}

interface CanvasLinkTargetPickerProps {
  document: CanvasWorkspaceDocument;
  onCancel: () => void;
  onFocusExistingEdge: (edgeId: string) => void;
  onSelect: (nodeId: string) => void;
  request: CanvasLinkTargetRequest;
  sourceLabel: string;
}

function TargetIcon({ option }: { option: CanvasLinkTargetOption }) {
  switch (option.type) {
    case "paper":
      return <Article size={17} weight="duotone" />;
    case "excerpt":
      return <Quotes size={17} weight="duotone" />;
    case "ai-synth":
      return <Sparkle size={17} weight="fill" />;
    case "idea-note":
      return <Lightbulb size={17} weight="duotone" />;
    case "group":
      return <BoundingBox size={17} weight="duotone" />;
  }
}

function optionId(index: number): string {
  return `canvas-link-target-option-${index}`;
}

export function CanvasLinkTargetPicker({
  document,
  onCancel,
  onFocusExistingEdge,
  onSelect,
  request,
  sourceLabel,
}: CanvasLinkTargetPickerProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const pickerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewport = useViewport();
  const options = useMemo(
    () => buildCanvasLinkTargetOptions(document, request.sourceId, query, request.position),
    [document, query, request.position, request.sourceId],
  );
  const boundedActiveIndex = options.length
    ? Math.min(Math.max(activeIndex, 0), options.length - 1)
    : 0;
  const activeOption = options[boundedActiveIndex];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    const cancelOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return;
      onCancel();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("pointerdown", cancelOnOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("pointerdown", cancelOnOutsidePointer, true);
    };
  }, [onCancel]);

  const runOption = (option: CanvasLinkTargetOption | undefined) => {
    if (!option) return;
    if (option.existingEdgeId) {
      onFocusExistingEdge(option.existingEdgeId);
      return;
    }
    onSelect(option.nodeId);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || !options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? (current + 1) % options.length
          : (current - 1 + options.length) % options.length,
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runOption(activeOption);
    }
  };

  return (
    <aside
      ref={pickerRef}
      className="canvas-link-target-picker nodrag nopan nowheel"
      role="dialog"
      aria-label={`选择从“${sourceLabel}”连接到的卡片`}
      style={
        {
          "--canvas-link-target-x": `${request.position.x * viewport.zoom + viewport.x}px`,
          "--canvas-link-target-y": `${request.position.y * viewport.zoom + viewport.y}px`,
        } as CSSProperties
      }
      data-canvas-interactive="true"
      data-source-id={request.sourceId}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="canvas-link-target-picker__header">
        <div>
          <strong>连接到…</strong>
          <span title={`${sourceLabel} → 选择目标`}>{sourceLabel} → 选择目标</span>
        </div>
        <button type="button" onClick={onCancel} aria-label="取消选择目标" title="取消（Esc）">
          <X size={15} weight="bold" />
        </button>
      </header>

      <label className="canvas-link-target-picker__search">
        <MagnifyingGlass size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-activedescendant={activeOption ? optionId(boundedActiveIndex) : undefined}
          aria-autocomplete="list"
          aria-controls="canvas-link-target-list"
          autoComplete="off"
          maxLength={160}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="搜索当前白板卡片"
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </label>

      <div
        className="canvas-link-target-picker__list"
        id="canvas-link-target-list"
        role="listbox"
        aria-label="可连接的目标卡片"
      >
        {options.map((option, index) => {
          const active = index === boundedActiveIndex;
          return (
            <button
              key={option.nodeId}
              id={optionId(index)}
              type="button"
              role="option"
              aria-selected={active}
              className={`canvas-link-target-picker__option${
                active ? " canvas-link-target-picker__option--active" : ""
              }${option.existingEdgeId ? " canvas-link-target-picker__option--connected" : ""}`}
              onClick={() => runOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="canvas-link-target-picker__icon" aria-hidden="true">
                <TargetIcon option={option} />
              </span>
              <span className="canvas-link-target-picker__copy">
                <strong>{option.label}</strong>
                <small>
                  {option.groupLabel ? `分组：${option.groupLabel} · ` : ""}
                  {option.description}
                </small>
              </span>
              <span className="canvas-link-target-picker__state">
                {option.existingEdgeId ? "已连接 · 定位" : "选择"}
              </span>
            </button>
          );
        })}
        {!options.length && (
          <p className="canvas-link-target-picker__empty">
            {query.trim() ? "当前白板中没有匹配卡片。" : "当前白板中没有其他可连接卡片。"}
          </p>
        )}
      </div>
      <small className="canvas-link-target-picker__hint">↑↓ 选择 · Enter 确认 · Esc 取消</small>
    </aside>
  );
}
