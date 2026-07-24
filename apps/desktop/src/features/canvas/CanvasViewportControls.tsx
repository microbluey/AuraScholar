import { Compass, CornersOut, Minus, Plus, X } from "@phosphor-icons/react";
import { useViewport } from "@xyflow/react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

export interface CanvasViewportControlsProps {
  className?: string;
  defaultOverviewOpen?: boolean;
  edgeCount?: number;
  maxZoom?: number;
  minZoom?: number;
  miniMap: ReactNode;
  nodeCount?: number;
  onFitView: () => void;
  onOverviewOpenChange?: (open: boolean) => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export function CanvasViewportControls({
  className,
  defaultOverviewOpen = false,
  edgeCount,
  maxZoom = 2.4,
  minZoom = 0.2,
  miniMap,
  nodeCount,
  onFitView,
  onOverviewOpenChange,
  onResetZoom,
  onZoomIn,
  onZoomOut,
}: CanvasViewportControlsProps) {
  const { zoom } = useViewport();
  const [overviewOpen, setOverviewOpen] = useState(defaultOverviewOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const overviewTriggerRef = useRef<HTMLButtonElement>(null);
  const overviewId = useId();
  const zoomPercent = Math.round(zoom * 100);

  const changeOverviewOpen = useCallback(
    (open: boolean) => {
      setOverviewOpen(open);
      onOverviewOpenChange?.(open);
    },
    [onOverviewOpenChange],
  );

  useEffect(() => {
    if (!overviewOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      changeOverviewOpen(false);
      window.requestAnimationFrame(() => overviewTriggerRef.current?.focus());
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      changeOverviewOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [changeOverviewOpen, overviewOpen]);

  return (
    <div ref={rootRef} className={joinClassNames("canvas-viewport-controls", className)}>
      {overviewOpen && (
        <section
          id={overviewId}
          className="canvas-viewport-controls__overview"
          role="dialog"
          aria-label="画布概览"
        >
          <header className="canvas-viewport-controls__overview-header">
            <div>
              <strong>画布概览</strong>
              {(nodeCount !== undefined || edgeCount !== undefined) && (
                <small>
                  {nodeCount !== undefined ? `${nodeCount} 张卡片` : null}
                  {nodeCount !== undefined && edgeCount !== undefined ? " · " : null}
                  {edgeCount !== undefined ? `${edgeCount} 条关系` : null}
                </small>
              )}
            </div>
            <button
              type="button"
              onClick={() => changeOverviewOpen(false)}
              aria-label="关闭画布概览"
              title="关闭"
            >
              <X size={16} weight="bold" />
            </button>
          </header>
          <div className="canvas-viewport-controls__minimap" aria-label="画布小地图">
            {miniMap}
          </div>
          <button
            className="canvas-viewport-controls__fit-action"
            type="button"
            onClick={onFitView}
          >
            <CornersOut size={17} weight="duotone" />
            <span>显示全部卡片</span>
          </button>
          <p>可在小地图中拖动视口，或滚轮缩放画布。</p>
        </section>
      )}

      <div className="canvas-viewport-controls__bar" role="toolbar" aria-label="画布视图控制">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= minZoom + 0.001}
          aria-label="缩小画布"
          title="缩小"
        >
          <Minus size={17} weight="bold" />
        </button>
        <button
          type="button"
          className="canvas-viewport-controls__zoom"
          aria-label={`当前缩放比例 ${zoomPercent}%`}
          onClick={onResetZoom}
          title="恢复 100% 缩放"
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= maxZoom - 0.001}
          aria-label="放大画布"
          title="放大"
        >
          <Plus size={17} weight="bold" />
        </button>
        <span className="canvas-viewport-controls__divider" aria-hidden="true" />
        <button type="button" onClick={onFitView} aria-label="适配全部卡片" title="适配全部卡片">
          <CornersOut size={17} weight="duotone" />
        </button>
        <button
          ref={overviewTriggerRef}
          className={joinClassNames(overviewOpen && "canvas-viewport-controls__button--active")}
          type="button"
          onClick={() => changeOverviewOpen(!overviewOpen)}
          aria-label={`${overviewOpen ? "收起" : "打开"}画布概览`}
          aria-expanded={overviewOpen}
          aria-controls={overviewId}
          title="画布概览"
        >
          <Compass size={18} weight="duotone" />
        </button>
      </div>
    </div>
  );
}
