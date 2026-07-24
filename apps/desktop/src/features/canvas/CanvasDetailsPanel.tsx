import type { CanvasEdge, CanvasEdgeRelation, CanvasNode } from "@aurascholar/core";
import {
  Article,
  ArrowSquareOut,
  BoundingBox,
  CaretDown,
  CaretRight,
  Link,
  Lightbulb,
  Quotes,
  Sparkle,
  Trash,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { RELATION_LABELS, SYNTHESIS_LABELS } from "./model";

interface CanvasDetailsPanelProps {
  edge: CanvasEdge | null;
  groupChildCount: number;
  node: CanvasNode | null;
  onActivateNode: (node: CanvasNode) => void;
  onDeleteEdge: (edgeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onSetGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  onUngroup: (groupId: string) => void;
  onUpdateEdge: (edge: CanvasEdge) => void;
  onUpdateNode: (node: CanvasNode) => void;
  selectedCount: number;
}

const RELATIONS = Object.keys(RELATION_LABELS) as CanvasEdgeRelation[];

function nodeKind(node: CanvasNode): { icon: ReactNode; label: string } {
  switch (node.type) {
    case "paper":
      return { icon: <Article size={18} weight="duotone" />, label: "文献信息" };
    case "excerpt":
      return { icon: <Quotes size={18} weight="duotone" />, label: "摘录与边注" };
    case "ai-synth":
      return { icon: <Sparkle size={18} weight="fill" />, label: "AI 合成编辑" };
    case "idea-note":
      return { icon: <Lightbulb size={18} weight="duotone" />, label: "研究笔记编辑" };
    case "group":
      return { icon: <BoundingBox size={18} weight="duotone" />, label: "分组设置" };
  }
}

function DetailsField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="canvas-details__field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NodeFields({
  groupChildCount,
  node,
  onActivateNode,
  onSetGroupCollapsed,
  onUngroup,
  onUpdateNode,
}: Pick<
  CanvasDetailsPanelProps,
  | "groupChildCount"
  | "node"
  | "onActivateNode"
  | "onSetGroupCollapsed"
  | "onUngroup"
  | "onUpdateNode"
> & {
  node: CanvasNode;
}) {
  if (node.type === "paper") {
    return (
      <div className="canvas-details__metadata">
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
          className="canvas-details__primary"
          type="button"
          onClick={() => onActivateNode(node)}
        >
          在同屏阅读器中打开
          <ArrowSquareOut size={15} weight="bold" />
        </button>
      </div>
    );
  }

  if (node.type === "excerpt") {
    return (
      <div className="canvas-details__metadata">
        <h3>{node.data.paperTitle}</h3>
        <p className="canvas-details__quote">“{node.data.highlightText}”</p>
        <p>第 {node.data.pageIndex + 1} 页</p>
        <DetailsField label="边注">
          <textarea
            data-autofocus
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
        </DetailsField>
        <button
          className="canvas-details__primary"
          type="button"
          onClick={() => onActivateNode(node)}
        >
          在同屏阅读器中定位
          <ArrowSquareOut size={15} weight="bold" />
        </button>
      </div>
    );
  }

  if (node.type === "idea-note") {
    return (
      <div className="canvas-details__form">
        <DetailsField label="标题">
          <input
            data-autofocus
            value={node.data.title || ""}
            onChange={(event) =>
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, title: event.target.value || undefined },
              })
            }
          />
        </DetailsField>
        <DetailsField label="Markdown / LaTeX 内容">
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
        </DetailsField>
        <small>支持 GFM 表格、任务列表以及 `$...$` / `$$...$$` 数学公式。</small>
      </div>
    );
  }

  if (node.type === "ai-synth") {
    return (
      <div className="canvas-details__form">
        <span className="canvas-details__mode">{SYNTHESIS_LABELS[node.data.synthType]}</span>
        <DetailsField label="标题">
          <input
            data-autofocus
            value={node.data.title}
            onChange={(event) =>
              onUpdateNode({
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, title: event.target.value },
              })
            }
          />
        </DetailsField>
        <DetailsField label="合成内容">
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
        </DetailsField>
        <small>{node.data.sourceNodeIds.length} 个来源节点</small>
      </div>
    );
  }

  return (
    <div className="canvas-details__form">
      <DetailsField label="分组标题">
        <input
          data-autofocus
          value={node.data.title}
          onChange={(event) =>
            onUpdateNode({
              ...node,
              updatedAt: Date.now(),
              data: { ...node.data, title: event.target.value },
            })
          }
        />
      </DetailsField>
      <span className="canvas-details__group-status">
        {groupChildCount} 张卡片 · {node.data.collapsed ? "已折叠" : "已展开"}
      </span>
      <button
        className="canvas-details__secondary"
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
        className="canvas-details__secondary"
        type="button"
        onClick={() => onUngroup(node.id)}
      >
        解除分组并保留卡片
      </button>
    </div>
  );
}

export function CanvasDetailsPanel({
  edge,
  groupChildCount,
  node,
  onActivateNode,
  onDeleteEdge,
  onDeleteNode,
  onSetGroupCollapsed,
  onUngroup,
  onUpdateEdge,
  onUpdateNode,
  selectedCount,
}: CanvasDetailsPanelProps) {
  const kind = node ? nodeKind(node) : null;
  const targetId = node?.id ?? edge?.id ?? (selectedCount > 1 ? "selection" : "empty");

  return (
    <div className="canvas-details" data-canvas-details-for={targetId}>
      <div className="canvas-details__kind">
        {kind?.icon || (edge ? <Link size={18} weight="duotone" /> : <BoundingBox size={18} />)}
        <strong>{kind?.label || (edge ? "关系连线编辑" : "选择详情")}</strong>
      </div>

      {selectedCount > 1 ? (
        <div className="canvas-details__empty">
          <BoundingBox size={28} weight="duotone" />
          <strong>已选择 {selectedCount} 张卡片</strong>
          <p>选择多张卡片后，可从选区上方的浮条创建分组、整理或进行 AI 合成。</p>
        </div>
      ) : node ? (
        <NodeFields
          node={node}
          groupChildCount={groupChildCount}
          onActivateNode={onActivateNode}
          onSetGroupCollapsed={onSetGroupCollapsed}
          onUngroup={onUngroup}
          onUpdateNode={onUpdateNode}
        />
      ) : edge ? (
        <div className="canvas-details__form">
          <DetailsField label="关系类型">
            <select
              data-autofocus
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
          </DetailsField>
          <DetailsField label="关系说明">
            <input
              value={edge.label || ""}
              onChange={(event) =>
                onUpdateEdge({ ...edge, label: event.target.value, updatedAt: Date.now() })
              }
            />
          </DetailsField>
        </div>
      ) : (
        <div className="canvas-details__empty">
          <Link size={28} weight="duotone" />
          <strong>选择一张卡片或连线</strong>
          <p>单击卡片打开内容；使用右键或卡片上的“…”执行更多操作。</p>
        </div>
      )}

      {(edge || (node && node.type !== "group")) && selectedCount <= 1 && (
        <button
          className="canvas-details__delete"
          type="button"
          onClick={() => (node ? onDeleteNode(node.id) : edge && onDeleteEdge(edge.id))}
        >
          <Trash size={17} weight="duotone" />
          {node ? "仅从画布移除" : "删除这条连线"}
        </button>
      )}
    </div>
  );
}
