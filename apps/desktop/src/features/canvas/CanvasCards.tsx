import type { CanvasNode, CanvasNodeType } from "@aurascholar/core";
import {
  Article,
  ArrowSquareOut,
  BoundingBox,
  CaretDown,
  CaretRight,
  DotsThree,
  Lightbulb,
  Quotes,
  Sparkle,
} from "@phosphor-icons/react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export interface CanvasFlowNodeData extends Record<string, unknown> {
  canvasNode: CanvasNode;
  groupChildCount: number;
  onOpenPaper: (workId: string) => void;
  onOpenExcerpt: (
    workId: string,
    annotationId?: string,
    pageIndex?: number,
    attachmentId?: string,
  ) => void;
  onToggleGroup: (groupId: string, collapsed: boolean) => void;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, CanvasNodeType>;

function ConnectionHandles() {
  return (
    <>
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
    </>
  );
}

function CardShell({
  children,
  className = "",
  label,
  selected,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  selected: boolean;
}) {
  return (
    <article
      className={`canvas-card ${className}${selected ? " canvas-card--selected" : ""}`}
      aria-label={label}
      tabIndex={0}
    >
      <ConnectionHandles />
      {children}
    </article>
  );
}

function CardHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <header className="canvas-card__header">
      <span className="canvas-card__kind">
        {icon}
        {label}
      </span>
      <DotsThree aria-hidden="true" size={19} weight="bold" />
    </header>
  );
}

function compactAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} 等`;
}

export function PaperCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "paper") return null;
  const metadata = [compactAuthors(node.data.authors), node.data.year].filter(Boolean).join(" · ");
  return (
    <CardShell
      className="canvas-card--paper"
      label={`文献：${node.data.title}`}
      selected={selected}
    >
      <CardHeader icon={<Article size={17} weight="duotone" />} label="文献卡片" />
      <h2 className="canvas-card__title">{node.data.title}</h2>
      <p className="canvas-card__metadata">{metadata || "作者与年份待补全"}</p>
      {node.data.venue && <span className="canvas-card__venue">{node.data.venue}</span>}
      <p className="canvas-card__abstract">
        {node.data.abstractSnippet || "这篇文献尚无摘要，可先在画布中占位、分组和建立关系。"}
      </p>
      <footer className="canvas-card__footer">
        <span>画布内 {node.data.annotationCount} 条摘录</span>
        <button
          className="canvas-card__action nodrag"
          type="button"
          onClick={() => data.onOpenPaper(node.data.workId)}
          title="在同屏阅读器中打开"
          aria-label={`在同屏阅读器中打开《${node.data.title}》`}
        >
          打开
          <ArrowSquareOut size={15} weight="bold" />
        </button>
      </footer>
    </CardShell>
  );
}

export function ExcerptCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "excerpt") return null;
  return (
    <CardShell
      className="canvas-card--excerpt"
      label={`摘录：${node.data.paperTitle} 第 ${node.data.pageIndex + 1} 页`}
      selected={selected}
    >
      <CardHeader icon={<Quotes size={17} weight="duotone" />} label="文献摘录" />
      <p className="canvas-card__source" title={node.data.paperTitle}>
        {node.data.paperTitle}
      </p>
      <blockquote className="canvas-card__quote" data-highlight-color={node.data.highlightColor}>
        {node.data.highlightText}
      </blockquote>
      {node.data.marginNote && <p className="canvas-card__note">{node.data.marginNote}</p>}
      <footer className="canvas-card__footer">
        <span>第 {node.data.pageIndex + 1} 页</span>
        <button
          className="canvas-card__action nodrag"
          type="button"
          onClick={() =>
            data.onOpenExcerpt(
              node.data.workId,
              node.data.annotationId,
              node.data.pageIndex,
              node.data.attachmentId,
            )
          }
          title="在同屏阅读器中定位原文"
          aria-label={`在同屏阅读器中定位《${node.data.paperTitle}》第 ${node.data.pageIndex + 1} 页`}
        >
          定位原文
          <ArrowSquareOut size={15} weight="bold" />
        </button>
      </footer>
    </CardShell>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <div className="canvas-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function AISynthCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "ai-synth") return null;
  const preview = node.data.modelName === "preview" || node.data.modelName === "preview-fallback";
  return (
    <CardShell
      className="canvas-card--ai"
      label={`AI 合成：${node.data.title}`}
      selected={selected}
    >
      <CardHeader icon={<Sparkle size={17} weight="fill" />} label="AI 合成" />
      <div className="canvas-card__ai-title-row">
        <h2 className="canvas-card__title">{node.data.title}</h2>
        {preview && <span className="canvas-card__preview-badge">预览</span>}
      </div>
      {preview && (
        <p className="canvas-card__preview-note">未连接 AI 服务，仅展示来源组织与交互效果。</p>
      )}
      {node.data.structuredTable ? (
        <>
          <MarkdownPreview markdown={node.data.contentMarkdown} />
          <div className="canvas-synth-table">
            <table aria-label={node.data.title}>
              <thead>
                <tr>
                  {node.data.structuredTable.headers.map((header, index) => (
                    <th scope="col" key={`${header}-${index}`}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.data.structuredTable.rows.map((row, rowIndex) => (
                  <tr key={`${row.join("-")}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${cell}-${cellIndex}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <MarkdownPreview markdown={node.data.contentMarkdown} />
      )}
      <footer className="canvas-card__footer">
        <span>{node.data.sourceNodeIds.length} 个来源</span>
        <span>{node.data.modelName || "等待服务"}</span>
      </footer>
    </CardShell>
  );
}

export function IdeaNoteCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "idea-note") return null;
  return (
    <CardShell
      className="canvas-card--idea"
      label={`研究笔记：${node.data.title || "未命名"}`}
      selected={selected}
    >
      <CardHeader icon={<Lightbulb size={17} weight="duotone" />} label="研究想法" />
      <h2 className="canvas-card__title">{node.data.title || "未命名笔记"}</h2>
      <MarkdownPreview markdown={node.data.contentMarkdown} />
      {node.data.hasEquations && <span className="canvas-card__equation-label">包含公式</span>}
    </CardShell>
  );
}

export function GroupCard({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "group") return null;
  const collapsed = node.data.collapsed === true;
  const action = collapsed ? "展开" : "折叠";
  return (
    <section
      className={`canvas-group-node${collapsed ? " canvas-group-node--collapsed" : ""}${selected ? " canvas-group-node--selected" : ""}`}
      aria-label={`分组：${node.data.title}，${collapsed ? "已折叠" : "已展开"}，${data.groupChildCount} 张卡片`}
      tabIndex={0}
    >
      <ConnectionHandles />
      <div className="canvas-group-node__label">
        <button
          className="canvas-group-node__toggle nodrag nopan"
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${action}分组“${node.data.title}”`}
          title={`${action}分组`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleGroup(node.id, !collapsed);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            data.onToggleGroup(node.id, !collapsed);
          }}
        >
          {collapsed ? (
            <CaretRight size={14} weight="bold" />
          ) : (
            <CaretDown size={14} weight="bold" />
          )}
        </button>
        <BoundingBox size={17} weight="duotone" />
        <span className="canvas-group-node__title">{node.data.title}</span>
        <small className="canvas-group-node__count">{data.groupChildCount} 张</small>
      </div>
    </section>
  );
}

export const canvasNodeTypes = {
  paper: PaperCard,
  excerpt: ExcerptCard,
  "ai-synth": AISynthCard,
  "idea-note": IdeaNoteCard,
  group: GroupCard,
};
