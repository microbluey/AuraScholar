import type { CanvasEdge, CanvasNode } from "@aurascholar/core";
import { Books, NotePencil, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { CanvasDetailsPanel } from "./CanvasDetailsPanel";
import { CanvasLibraryPanel } from "./CanvasLibraryPanel";
import type { CanvasToolboxPanel } from "./canvas-interactions";
import type { CanvasLibraryWork } from "./model";

interface CanvasToolboxProps {
  activePanel: CanvasToolboxPanel | null;
  autoFocusDetails: boolean;
  addedWorkIds: Set<string>;
  edge: CanvasEdge | null;
  groupChildCount: number;
  libraryLoading: boolean;
  node: CanvasNode | null;
  onActivateNode: (node: CanvasNode) => void;
  onAddWork: (work: CanvasLibraryWork) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onPanelChange: (panel: CanvasToolboxPanel | null) => void;
  onSetGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  onUngroup: (groupId: string) => void;
  onUpdateEdge: (edge: CanvasEdge) => void;
  onUpdateNode: (node: CanvasNode) => void;
  selectedCount: number;
  works: CanvasLibraryWork[];
}

const PANEL_META = {
  library: { icon: Books, label: "文献库" },
  details: { icon: NotePencil, label: "详情与编辑" },
} as const;

export function CanvasToolbox({
  activePanel,
  autoFocusDetails,
  addedWorkIds,
  edge,
  groupChildCount,
  libraryLoading,
  node,
  onActivateNode,
  onAddWork,
  onDeleteEdge,
  onDeleteNode,
  onPanelChange,
  onSetGroupCollapsed,
  onUngroup,
  onUpdateEdge,
  onUpdateNode,
  selectedCount,
  works,
}: CanvasToolboxProps) {
  const panelRef = useRef<HTMLElement>(null);
  const activeMeta = activePanel ? PANEL_META[activePanel] : null;
  const ActiveIcon = activeMeta?.icon;

  useEffect(() => {
    if (activePanel !== "details" || !autoFocusDetails) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, autoFocusDetails, edge?.id, node?.id, selectedCount]);

  if (!activePanel || !activeMeta || !ActiveIcon) return null;

  return (
    <aside className="canvas-toolbox nodrag nopan nowheel" aria-label="画布工具箱">
      <section
        ref={panelRef}
        className="canvas-toolbox__panel"
        id={`canvas-toolbox-panel-${activePanel}`}
        data-canvas-toolbox-panel={activePanel}
        aria-label={activeMeta.label}
        tabIndex={-1}
      >
        <header className="canvas-toolbox__header">
          <div>
            <ActiveIcon size={19} weight="duotone" />
            <strong>{activeMeta.label}</strong>
          </div>
          <button
            type="button"
            onClick={() => onPanelChange(null)}
            aria-label={`收起${activeMeta.label}`}
            title="收起工具箱"
          >
            <X size={17} weight="bold" />
          </button>
        </header>

        <div className="canvas-toolbox__body">
          {activePanel === "library" && (
            <CanvasLibraryPanel
              works={works}
              loading={libraryLoading}
              addedWorkIds={addedWorkIds}
              onAddWork={onAddWork}
            />
          )}
          {activePanel === "details" && (
            <CanvasDetailsPanel
              node={node}
              edge={edge}
              groupChildCount={groupChildCount}
              selectedCount={selectedCount}
              onActivateNode={onActivateNode}
              onUpdateNode={onUpdateNode}
              onUpdateEdge={onUpdateEdge}
              onDeleteNode={onDeleteNode}
              onDeleteEdge={onDeleteEdge}
              onUngroup={onUngroup}
              onSetGroupCollapsed={onSetGroupCollapsed}
            />
          )}
        </div>
      </section>
    </aside>
  );
}
