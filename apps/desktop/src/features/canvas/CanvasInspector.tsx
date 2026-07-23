import type { CanvasEdge, CanvasEdgeRelation, CanvasNode } from "@aurascholar/core";
import {
  Article,
  BoundingBox,
  CaretDown,
  CaretRight,
  Link,
  Lightbulb,
  Quotes,
  SidebarSimple,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { RELATION_LABELS, SYNTHESIS_LABELS } from "./model";

interface CanvasInspectorProps {
  edge: CanvasEdge | null;
  groupChildCount: number;
  miniMap: ReactNode;
  node: CanvasNode | null;
  onClose: () => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onOpenPaper: (workId: string) => void;
  onSetGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  onUngroup: (groupId: string) => void;
  onUpdateEdge: (edge: CanvasEdge) => void;
  onUpdateNode: (node: CanvasNode) => void;
  open: boolean;
  selectedCount: number;
}

const RELATIONS = Object.keys(RELATION_LABELS) as CanvasEdgeRelation[];

function nodeKind(node: CanvasNode): { icon: ReactNode; label: string } {
  switch (node.type) {
    case "paper":
      return { icon: <Article size={18} weight="duotone" />, label: "文献卡片" };
    case "excerpt":
      return { icon: <Quotes size={18} weight="duotone" />, label: "文献摘录" };
    case "ai-synth":
      return { icon: <Sparkle size={18} weight="fill" />, label: "AI 合成" };
    case "idea-note":
      return { icon: <Lightbulb size={18} weight="duotone" />, label: "研究想法" };
    case "group":
      return { icon: <BoundingBox size={18} weight="duotone" />, label: "逻辑分组" };
  }
}

function InspectorField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="canvas-inspector__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NodeFields({
  groupChildCount,
  node,
  onOpenPaper,
  onSetGroupCollapsed,
  onUngroup,
  onUpdateNode,
}: Pick<
  CanvasInspectorProps,
  "groupChildCount" | "node" | "onOpenPaper" | "onSetGroupCollapsed" | "onUngroup" | "onUpdateNode"
> & {
  node: CanvasNode;
}) {
  if (node.type === "paper") {
    return (
      <div className="canvas-inspector__metadata">
        <h3>{node.data.title}</h3>
        <dl>
          <div>
            <dt>作者</dt>
            <dd>{node.data.authors.join(", ") || "待补全"}</dd>
          </div>
          <div>
            <dt>年份</dt>
            <dd>{node.data.year ?? "待补全"}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{node.data.venue || "待补全"}</dd>
          </div>
          {node.data.doi && (
            <div>
              <dt>DOI</dt>
              <dd>{node.data.doi}</dd>
            </div>
          )}
        </dl>
        {node.data.abstractSnippet && <p>{node.data.abstractSnippet}</p>}
        <button
          className="canvas-inspector__primary"
          type="button"
          onClick={() => onOpenPaper(node.data.workId)}
        >
          在阅读器中打开
        </button>
      </div>
    );
  }

  if (node.type === "excerpt") {
    return (
      <div className="canvas-inspector__metadata">
        <h3>{node.data.paperTitle}</h3>
        <p className="canvas-inspector__quote">“{node.data.highlightText}”</p>
        <p>第 {node.data.pageIndex + 1} 页</p>
        <InspectorField label="边注">
          <textarea
            value={node.data.marginNote || ""}
            onChange={(event) =>
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, marginNote: event.target.value || undefined },
              })
            }
            rows={4}
          />
        </InspectorField>
      </div>
    );
  }

  if (node.type === "idea-note") {
    return (
      <div className="canvas-inspector__form">
        <InspectorField label="标题">
          <input
            value={node.data.title || ""}
            onChange={(event) =>
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, title: event.target.value || undefined },
              })
            }
          />
        </InspectorField>
        <InspectorField label="Markdown / LaTeX 内容">
          <textarea
            value={node.data.contentMarkdown}
            onChange={(event) => {
              const contentMarkdown = event.target.value;
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: {
                  ...node.data,
                  contentMarkdown,
                  hasEquations: /\$[^$]+\$|\\\(|\\\[/.test(contentMarkdown),
                },
              });
            }}
            rows={10}
          />
        </InspectorField>
        <small>支持 GFM 表格、任务列表以及 `$...$` / `$$...$$` 数学公式。</small>
      </div>
    );
  }

  if (node.type === "ai-synth") {
    return (
      <div className="canvas-inspector__form">
        <span className="canvas-inspector__mode">{SYNTHESIS_LABELS[node.data.synthType]}</span>
        <InspectorField label="标题">
          <input
            value={node.data.title}
            onChange={(event) =>
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, title: event.target.value },
              })
            }
          />
        </InspectorField>
        <InspectorField label="合成内容">
          <textarea
            value={node.data.contentMarkdown}
            onChange={(event) =>
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, contentMarkdown: event.target.value },
              })
            }
            rows={10}
          />
        </InspectorField>
        <small>{node.data.sourceNodeIds.length} 个来源节点</small>
      </div>
    );
  }

  return (
    <div className="canvas-inspector__form">
      <InspectorField label="分组标题">
        <input
          value={node.data.title}
          onChange={(event) =>
            onUpdateNode({
              ...node,
              updatedAt: Date.now(),
              data: { ...node.data, title: event.target.value },
            })
          }
        />
      </InspectorField>
      <span className="canvas-inspector__group-status">
        {groupChildCount} 张卡片 · {node.data.collapsed ? "已折叠" : "已展开"}
      </span>
      <button
        className="canvas-inspector__secondary"
        type="button"
        onClick={() => onSetGroupCollapsed(node.id, node.data.collapsed !== true)}
      >
        {node.data.collapsed ? (
          <CaretRight size={16} weight="bold" />
        ) : (
          <CaretDown size={16} weight="bold" />
        )}
        {node.data.collapsed ? "展开分组" : "折叠分组"}
      </button>
      <small>折叠只收起组内卡片与连线，不会删除内容。</small>
      <button
        className="canvas-inspector__secondary"
        type="button"
        onClick={() => onUngroup(node.id)}
      >
        解除分组并保留卡片
      </button>
    </div>
  );
}

export function CanvasInspector({
  edge,
  groupChildCount,
  miniMap,
  node,
  onClose,
  onDeleteEdge,
  onDeleteNode,
  onOpenPaper,
  onSetGroupCollapsed,
  onUngroup,
  onUpdateEdge,
  onUpdateNode,
  open,
  selectedCount,
}: CanvasInspectorProps) {
  const kind = node ? nodeKind(node) : null;
  return (
    <aside
      className={`canvas-inspector${open ? " canvas-inspector--open" : ""}`}
      aria-label="画布检查器"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="canvas-inspector__header">
        <div>
          {kind?.icon || <SidebarSimple size={18} weight="duotone" />}
          <strong>{kind?.label || (edge ? "关系连线" : "画布检查器")}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="收起检查器" title="收起检查器">
          <X size={18} weight="bold" />
        </button>
      </header>

      <div className="canvas-inspector__body">
        {selectedCount > 1 ? (
          <div className="canvas-inspector__empty">
            <BoundingBox size={28} weight="duotone" />
            <strong>已选择 {selectedCount} 张卡片</strong>
            <p>可以从底部工具栏创建分组，或用 AI 合成比较文献与摘录。</p>
          </div>
        ) : node ? (
          <NodeFields
            node={node}
            groupChildCount={groupChildCount}
            onOpenPaper={onOpenPaper}
            onSetGroupCollapsed={onSetGroupCollapsed}
            onUngroup={onUngroup}
            onUpdateNode={onUpdateNode}
          />
        ) : edge ? (
          <div className="canvas-inspector__form">
            <InspectorField label="关系类型">
              <select
                value={edge.relationType}
                onChange={(event) => {
                  const relationType = event.target.value as CanvasEdgeRelation;
                  onUpdateEdge({
                    ...edge,
                    relationType,
                    label: RELATION_LABELS[relationType],
                    updatedAt: Date.now(),
                  });
                }}
              >
                {RELATIONS.map((relation) => (
                  <option key={relation} value={relation}>
                    {RELATION_LABELS[relation]}
                  </option>
                ))}
              </select>
            </InspectorField>
            <InspectorField label="关系说明">
              <input
                value={edge.label || ""}
                onChange={(event) =>
                  onUpdateEdge({ ...edge, label: event.target.value, updatedAt: Date.now() })
                }
              />
            </InspectorField>
          </div>
        ) : (
          <div className="canvas-inspector__empty">
            <Link size={28} weight="duotone" />
            <strong>选择一张卡片或连线</strong>
            <p>在这里查看来源、编辑研究笔记和调整关系。</p>
          </div>
        )}

        {(edge || (node && node.type !== "group")) && selectedCount <= 1 && (
          <button
            className="canvas-inspector__delete"
            type="button"
            onClick={() => (node ? onDeleteNode(node.id) : edge && onDeleteEdge(edge.id))}
          >
            <Trash size={17} weight="duotone" />
            {node ? "仅从画布移除" : "删除这条连线"}
          </button>
        )}
      </div>

      <section className="canvas-inspector__minimap" aria-label="画布小地图">
        <div className="canvas-inspector__section-title">
          <span>MiniMap</span>
          <small>拖动导航</small>
        </div>
        {miniMap}
      </section>
    </aside>
  );
}
