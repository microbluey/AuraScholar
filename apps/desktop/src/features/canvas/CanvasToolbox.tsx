import type { CanvasEdge, CanvasNode } from "@aurascholar/core";
import { Books, Compass, CornersOut, NotePencil, SidebarSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import { CanvasDetailsPanel } from "./CanvasDetailsPanel";
import { CanvasLibraryPanel } from "./CanvasLibraryPanel";
import type { CanvasToolboxPanel } from "./canvas-interactions";
import type { CanvasLibraryWork } from "./model";

interface CanvasToolboxProps {
  activePanel: CanvasToolboxPanel | null;
  addedWorkIds: Set<string>;
  edge: CanvasEdge | null;
  edges: CanvasEdge[];
  groupChildCount: number;
  libraryLoading: boolean;
  miniMap: ReactNode;
  node: CanvasNode | null;
  nodes: CanvasNode[];
  onActivateNode: (node: CanvasNode) => void;
  onAddWork: (work: CanvasLibraryWork) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onFitView: () => void;
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
  overview: { icon: Compass, label: "画布导航" },
} as const;

const PANELS = Object.keys(PANEL_META) as CanvasToolboxPanel[];

export function CanvasToolbox({
  activePanel,
  addedWorkIds,
  edge,
  edges,
  groupChildCount,
  libraryLoading,
  miniMap,
  node,
  nodes,
  onActivateNode,
  onAddWork,
  onDeleteEdge,
  onDeleteNode,
  onFitView,
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
  const paperCount = nodes.filter((item) => item.type === "paper").length;
  const excerptCount = nodes.filter((item) => item.type === "excerpt").length;
  const authoredCount = nodes.filter(
    (item) => item.type === "idea-note" || item.type === "ai-synth",
  ).length;
  const groupCount = nodes.filter((item) => item.type === "group").length;

  useEffect(() => {
    if (activePanel !== "details") return;
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePanel, edge?.id, node?.id, selectedCount]);

  return (
    <aside
      className={`canvas-toolbox nodrag nopan nowheel${activePanel ? " canvas-toolbox--open" : ""}`}
      aria-label="画布工具箱"
    >
      <nav className="canvas-toolbox__rail" aria-label="画布工具" role="toolbar">
        <span className="canvas-toolbox__brand" aria-hidden="true">
          <SidebarSimple size={19} weight="duotone" />
        </span>
        {PANELS.map((panel) => {
          const meta = PANEL_META[panel];
          const Icon = meta.icon;
          const active = activePanel === panel;
          return (
            <button
              key={panel}
              type="button"
              className={active ? "canvas-toolbox__trigger--active" : undefined}
              data-canvas-toolbox-trigger={panel}
              aria-controls={`canvas-toolbox-panel-${panel}`}
              aria-expanded={active}
              aria-label={`${active ? "收起" : "打开"}${meta.label}`}
              title={meta.label}
              onClick={() => onPanelChange(active ? null : panel)}
            >
              <Icon size={20} weight={active ? "fill" : "duotone"} />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </nav>

      {activePanel && activeMeta && ActiveIcon && (
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
            {activePanel === "overview" && (
              <div className="canvas-overview">
                <div className="canvas-overview__stats" aria-label="画布内容统计">
                  <div>
                    <strong>{paperCount}</strong>
                    <span>文献</span>
                  </div>
                  <div>
                    <strong>{excerptCount}</strong>
                    <span>摘录</span>
                  </div>
                  <div>
                    <strong>{authoredCount}</strong>
                    <span>想法 / 合成</span>
                  </div>
                  <div>
                    <strong>{groupCount}</strong>
                    <span>分组</span>
                  </div>
                </div>
                <p className="canvas-overview__selection">
                  {selectedCount > 0
                    ? `当前已选择 ${selectedCount} 张卡片`
                    : `当前有 ${edges.length} 条语义关系`}
                </p>
                <button className="canvas-overview__fit" type="button" onClick={onFitView}>
                  <CornersOut size={17} weight="duotone" />
                  显示全部卡片
                </button>
                <section className="canvas-overview__minimap" aria-label="画布小地图">
                  <div className="canvas-overview__section-title">
                    <strong>MiniMap</strong>
                    <small>拖动导航</small>
                  </div>
                  {miniMap}
                </section>
                <p className="canvas-overview__hint">
                  单击卡片打开内容；右键、触摸板双指点击或卡片“…”可查看操作。
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
