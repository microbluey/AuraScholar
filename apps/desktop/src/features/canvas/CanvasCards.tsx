import type { CanvasNode, CanvasNodeType } from "@aurascholar/core";
import {
  Article,
  ArrowSquareOut,
  ArrowsOutSimple,
  BoundingBox,
  CaretDown,
  CaretRight,
  DotsThree,
  Lightbulb,
  Quotes,
  Sparkle,
} from "@phosphor-icons/react";
import type { Node, NodeProps } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { isImeComposing } from "../../keyboard";
import { CanvasConnectionHandles } from "./CanvasConnectionHandles";
import { CanvasMarkdown } from "./CanvasMarkdown";
import { registerCanvasEditorPreparer } from "./canvas-route-preparation";
import { isCanvasContextMenuShortcut } from "./canvas-interactions";
import type { IdeaNotePatch } from "./idea-note-edit";

export interface CanvasNodeMenuAnchor {
  clientX: number;
  clientY: number;
  returnFocusElement: HTMLElement;
}

export interface CanvasFlowNodeData extends Record<string, unknown> {
  canvasNode: CanvasNode;
  groupChildCount: number;
  menuOpen: boolean;
  onCommitIdeaNote: (nodeId: string, patch: IdeaNotePatch, field: "content" | "title") => void;
  onActivateNode: (nodeId: string) => void;
  onOpenIdeaNoteEditor: (
    nodeId: string,
    draft?: { contentMarkdown: string; title: string },
  ) => void;
  onOpenPaper: (workId: string) => void;
  onOpenExcerpt: (
    workId: string,
    annotationId?: string,
    pageIndex?: number,
    attachmentId?: string,
  ) => void;
  onRequestContextMenu: (nodeId: string, anchor: CanvasNodeMenuAnchor) => void;
  onToggleGroup: (groupId: string, collapsed: boolean) => void;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, CanvasNodeType>;

function CardShell({
  children,
  className = "",
  isConnectable,
  label,
  nodeId,
  onActivateNode,
  onRequestContextMenu,
  selected,
}: {
  children: ReactNode;
  className?: string;
  isConnectable: boolean;
  label: string;
  nodeId: string;
  onActivateNode: (nodeId: string) => void;
  onRequestContextMenu: (nodeId: string, anchor: CanvasNodeMenuAnchor) => void;
  selected: boolean;
}) {
  return (
    <article
      className={`canvas-card ${className}${selected ? " canvas-card--selected" : ""}`}
      aria-label={label}
      data-canvas-node-id={nodeId}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onActivateNode(nodeId);
          return;
        }
        if (
          !isCanvasContextMenuShortcut({
            composing: event.nativeEvent.isComposing,
            key: event.key,
            repeat: event.repeat,
            shiftKey: event.shiftKey,
          })
        ) {
          return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onRequestContextMenu(nodeId, {
          clientX: rect.right - 18,
          clientY: rect.top + 22,
          returnFocusElement: event.currentTarget,
        });
      }}
    >
      <CanvasConnectionHandles isConnectable={isConnectable} nodeId={nodeId} nodeLabel={label} />
      {children}
    </article>
  );
}

function CardHeader({
  actions,
  icon,
  label,
  menuLabel,
  menuOpen,
  nodeId,
  onRequestContextMenu,
}: {
  actions?: ReactNode;
  icon: ReactNode;
  label: string;
  menuLabel: string;
  menuOpen: boolean;
  nodeId: string;
  onRequestContextMenu: (nodeId: string, anchor: CanvasNodeMenuAnchor) => void;
}) {
  return (
    <header className="canvas-card__header">
      <span className="canvas-card__kind">
        {icon}
        {label}
      </span>
      <div className="canvas-card__header-actions">
        {actions}
        <button
          type="button"
          className="canvas-card__menu-button nodrag nopan"
          data-canvas-interactive
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onRequestContextMenu(nodeId, {
              clientX: rect.right,
              clientY: rect.bottom + 4,
              returnFocusElement: event.currentTarget,
            });
          }}
        >
          <DotsThree aria-hidden="true" size={19} weight="bold" />
        </button>
      </div>
    </header>
  );
}

function compactAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} 等`;
}

export function PaperCard({ data, isConnectable, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "paper") return null;
  const metadata = [compactAuthors(node.data.authors), node.data.year].filter(Boolean).join(" · ");
  return (
    <CardShell
      className="canvas-card--paper"
      isConnectable={isConnectable}
      label={`文献：${node.data.title}`}
      nodeId={node.id}
      onActivateNode={data.onActivateNode}
      onRequestContextMenu={data.onRequestContextMenu}
      selected={selected}
    >
      <CardHeader
        icon={<Article size={17} weight="duotone" />}
        label="文献卡片"
        menuLabel={`打开《${node.data.title}》的操作菜单`}
        menuOpen={data.menuOpen}
        nodeId={node.id}
        onRequestContextMenu={data.onRequestContextMenu}
      />
      <h2 className="canvas-card__title">{node.data.title}</h2>
      <p className="canvas-card__metadata">{metadata || "作者与年份待补全"}</p>
      {node.data.venue && <span className="canvas-card__venue">{node.data.venue}</span>}
      <p className="canvas-card__abstract">
        {node.data.abstractSnippet || "这篇文献尚无摘要，可先在画布中占位、分组和建立连线。"}
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

export function ExcerptCard({ data, isConnectable, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "excerpt") return null;
  return (
    <CardShell
      className="canvas-card--excerpt"
      isConnectable={isConnectable}
      label={`摘录：${node.data.paperTitle} 第 ${node.data.pageIndex + 1} 页`}
      nodeId={node.id}
      onActivateNode={data.onActivateNode}
      onRequestContextMenu={data.onRequestContextMenu}
      selected={selected}
    >
      <CardHeader
        icon={<Quotes size={17} weight="duotone" />}
        label="文献摘录"
        menuLabel={`打开《${node.data.paperTitle}》摘录的操作菜单`}
        menuOpen={data.menuOpen}
        nodeId={node.id}
        onRequestContextMenu={data.onRequestContextMenu}
      />
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

export function AISynthCard({ data, isConnectable, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "ai-synth") return null;
  const preview = node.data.modelName === "preview" || node.data.modelName === "preview-fallback";
  return (
    <CardShell
      className="canvas-card--ai"
      isConnectable={isConnectable}
      label={`AI 合成：${node.data.title}`}
      nodeId={node.id}
      onActivateNode={data.onActivateNode}
      onRequestContextMenu={data.onRequestContextMenu}
      selected={selected}
    >
      <CardHeader
        icon={<Sparkle size={17} weight="fill" />}
        label="AI 合成"
        menuLabel={`打开“${node.data.title}”的操作菜单`}
        menuOpen={data.menuOpen}
        nodeId={node.id}
        onRequestContextMenu={data.onRequestContextMenu}
      />
      <div className="canvas-card__ai-title-row">
        <h2 className="canvas-card__title">{node.data.title}</h2>
        {preview && <span className="canvas-card__preview-badge">预览</span>}
      </div>
      {preview && (
        <p className="canvas-card__preview-note">未连接 AI 服务，仅展示来源组织与交互效果。</p>
      )}
      {node.data.structuredTable ? (
        <>
          <CanvasMarkdown markdown={node.data.contentMarkdown} />
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
        <CanvasMarkdown markdown={node.data.contentMarkdown} />
      )}
      <footer className="canvas-card__footer">
        <span>{node.data.sourceNodeIds.length} 个来源</span>
        <span>{node.data.modelName || "等待服务"}</span>
      </footer>
    </CardShell>
  );
}

export function IdeaNoteCard({ data, isConnectable, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "idea-note") return null;
  return (
    <IdeaNoteCardContent
      data={data}
      isConnectable={isConnectable}
      node={node}
      selected={selected}
    />
  );
}

function IdeaNoteCardContent({
  data,
  isConnectable,
  node,
  selected,
}: {
  data: CanvasFlowNodeData;
  isConnectable: boolean;
  node: Extract<CanvasNode, { type: "idea-note" }>;
  selected: boolean;
}) {
  const [editingField, setEditingField] = useState<"content" | "title" | null>(null);
  const [titleDraft, setTitleDraft] = useState(node.data.title || "");
  const [contentDraft, setContentDraft] = useState(node.data.contentMarkdown);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLTextAreaElement>(null);
  const titleTriggerRef = useRef<HTMLButtonElement>(null);
  const contentTriggerRef = useRef<HTMLDivElement>(null);
  const editingSessionRef = useRef<"content" | "title" | null>(null);
  const composingRef = useRef(false);
  const pendingCompositionCommitRef = useRef<{
    field: "content" | "title";
    restoreFocus: boolean;
  } | null>(null);

  useEffect(() => {
    if (!editingField) return;
    const frame = window.requestAnimationFrame(() => {
      if (editingField === "title") {
        titleInputRef.current?.focus({ preventScroll: true });
        titleInputRef.current?.select();
        return;
      }
      const textarea = contentInputRef.current;
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingField]);

  const restoreTriggerFocus = useCallback((field: "content" | "title") => {
    window.requestAnimationFrame(() => {
      const trigger = field === "title" ? titleTriggerRef.current : contentTriggerRef.current;
      trigger?.focus({ preventScroll: true });
    });
  }, []);

  const beginEditing = (field: "content" | "title") => {
    if (field === "title") setTitleDraft(node.data.title || "");
    else setContentDraft(node.data.contentMarkdown);
    editingSessionRef.current = field;
    composingRef.current = false;
    pendingCompositionCommitRef.current = null;
    setEditingField(field);
  };

  const commit = useCallback(
    (field: "content" | "title", restoreFocus = false) => {
      if (editingSessionRef.current !== field) return;
      if (composingRef.current) {
        pendingCompositionCommitRef.current = { field, restoreFocus };
        return;
      }
      editingSessionRef.current = null;
      pendingCompositionCommitRef.current = null;
      if (field === "title") {
        const value = titleInputRef.current?.value ?? titleDraft;
        if (value.trim() !== (node.data.title || "")) {
          data.onCommitIdeaNote(node.id, { title: value }, "title");
        }
      } else {
        const value = contentInputRef.current?.value ?? contentDraft;
        if (value !== node.data.contentMarkdown) {
          data.onCommitIdeaNote(node.id, { contentMarkdown: value }, "content");
        }
      }
      setEditingField(null);
      if (restoreFocus) restoreTriggerFocus(field);
    },
    [
      contentDraft,
      data,
      node.data.contentMarkdown,
      node.data.title,
      node.id,
      restoreTriggerFocus,
      titleDraft,
    ],
  );

  useEffect(() => {
    if (!editingField) return;
    return registerCanvasEditorPreparer(() => {
      if (composingRef.current) return "cancel";
      commit(editingField);
      return "ready";
    });
  }, [commit, editingField]);

  const cancel = (field: "content" | "title", restoreFocus = false) => {
    if (editingSessionRef.current !== field) return;
    editingSessionRef.current = null;
    composingRef.current = false;
    pendingCompositionCommitRef.current = null;
    if (field === "title") setTitleDraft(node.data.title || "");
    else setContentDraft(node.data.contentMarkdown);
    setEditingField(null);
    if (restoreFocus) restoreTriggerFocus(field);
  };

  const handleCompositionEnd = (field: "content" | "title") => {
    composingRef.current = false;
    const pending = pendingCompositionCommitRef.current;
    if (!pending || pending.field !== field) return;
    pendingCompositionCommitRef.current = null;
    window.requestAnimationFrame(() => commit(field, pending.restoreFocus));
  };

  const handleInlineKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    field: "content" | "title",
  ) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel(field, true);
      return;
    }
    const shouldCommit =
      field === "title"
        ? event.key === "Enter"
        : event.key === "Enter" && (event.metaKey || event.ctrlKey);
    if (!shouldCommit) return;
    event.preventDefault();
    event.stopPropagation();
    commit(field, true);
  };

  const openExpandedEditor = () => {
    data.onOpenIdeaNoteEditor(node.id, {
      title: editingField === "title" ? titleDraft : node.data.title || "",
      contentMarkdown: editingField === "content" ? contentDraft : node.data.contentMarkdown,
    });
  };

  return (
    <CardShell
      className="canvas-card--idea"
      isConnectable={isConnectable}
      label={`研究笔记：${node.data.title || "未命名"}`}
      nodeId={node.id}
      onActivateNode={data.onActivateNode}
      onRequestContextMenu={data.onRequestContextMenu}
      selected={selected}
    >
      <CardHeader
        actions={
          <button
            type="button"
            className="canvas-card__expand-button nodrag nopan"
            data-canvas-interactive
            aria-label={`在专注 Markdown 编辑器中编辑“${node.data.title || "未命名笔记"}”`}
            title="展开 Markdown 编辑器"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openExpandedEditor();
            }}
          >
            <ArrowsOutSimple size={17} weight="bold" />
          </button>
        }
        icon={<Lightbulb size={17} weight="duotone" />}
        label="研究想法"
        menuLabel={`打开“${node.data.title || "未命名笔记"}”的操作菜单`}
        menuOpen={data.menuOpen}
        nodeId={node.id}
        onRequestContextMenu={data.onRequestContextMenu}
      />
      {editingField === "title" ? (
        <input
          ref={titleInputRef}
          className="canvas-note-card__title-input nodrag nopan"
          data-canvas-interactive
          data-canvas-native-history="true"
          aria-label="编辑笔记标题"
          value={titleDraft}
          maxLength={180}
          onBlur={() => commit("title")}
          onChange={(event) => setTitleDraft(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => handleCompositionEnd("title")}
          onKeyDown={(event) => handleInlineKeyDown(event, "title")}
          onPointerDown={(event) => event.stopPropagation()}
          placeholder="未命名笔记"
        />
      ) : (
        <h2 className="canvas-card__title canvas-note-card__title">
          <button
            ref={titleTriggerRef}
            type="button"
            className="canvas-note-card__edit-trigger nodrag nopan"
            data-canvas-interactive
            aria-label={`编辑笔记标题：${node.data.title || "未命名笔记"}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              beginEditing("title");
            }}
          >
            {node.data.title || "未命名笔记"}
          </button>
        </h2>
      )}
      {editingField === "content" ? (
        <div className="canvas-note-card__content-editor">
          <textarea
            ref={contentInputRef}
            className="canvas-note-card__content-input nodrag nopan nowheel"
            data-canvas-interactive
            data-canvas-native-history="true"
            aria-label="编辑笔记 Markdown 正文"
            value={contentDraft}
            onBlur={() => commit("content")}
            onChange={(event) => setContentDraft(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => handleCompositionEnd("content")}
            onKeyDown={(event) => handleInlineKeyDown(event, "content")}
            onPointerDown={(event) => event.stopPropagation()}
            placeholder="写下假设、证据线索或下一步问题……"
            spellCheck
          />
          <small>⌘/Ctrl + Enter 保存 · Esc 取消</small>
        </div>
      ) : (
        <div
          ref={contentTriggerRef}
          className="canvas-note-card__content-trigger nodrag nopan nowheel"
          data-canvas-interactive
          role="button"
          tabIndex={0}
          aria-label="编辑笔记 Markdown 正文"
          onClick={(event) => {
            event.stopPropagation();
            if (event.target instanceof Element && event.target.closest("a")) return;
            beginEditing("content");
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            beginEditing("content");
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CanvasMarkdown
            markdown={node.data.contentMarkdown}
            emptyLabel="点击写下假设、证据或下一步问题……"
          />
        </div>
      )}
      {node.data.hasEquations && <span className="canvas-card__equation-label">包含公式</span>}
    </CardShell>
  );
}

export function GroupCard({ data, isConnectable, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.canvasNode;
  if (node.type !== "group") return null;
  const collapsed = node.data.collapsed === true;
  const action = collapsed ? "展开" : "折叠";
  const label = `分组：${node.data.title}，${collapsed ? "已折叠" : "已展开"}，${data.groupChildCount} 张卡片`;
  return (
    <section
      className={`canvas-group-node${collapsed ? " canvas-group-node--collapsed" : ""}${selected ? " canvas-group-node--selected" : ""}`}
      aria-label={label}
      data-canvas-node-id={node.id}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          data.onActivateNode(node.id);
          return;
        }
        if (
          !isCanvasContextMenuShortcut({
            composing: event.nativeEvent.isComposing,
            key: event.key,
            repeat: event.repeat,
            shiftKey: event.shiftKey,
          })
        ) {
          return;
        }
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        data.onRequestContextMenu(node.id, {
          clientX: rect.right - 18,
          clientY: rect.top + 22,
          returnFocusElement: event.currentTarget,
        });
      }}
    >
      <CanvasConnectionHandles isConnectable={isConnectable} nodeId={node.id} nodeLabel={label} />
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
        <button
          type="button"
          className="canvas-group-node__menu nodrag nopan"
          data-canvas-interactive
          aria-label={`打开分组“${node.data.title}”的操作菜单`}
          aria-haspopup="menu"
          aria-expanded={data.menuOpen}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            data.onRequestContextMenu(node.id, {
              clientX: rect.right,
              clientY: rect.bottom + 4,
              returnFocusElement: event.currentTarget,
            });
          }}
        >
          <DotsThree aria-hidden="true" size={18} weight="bold" />
        </button>
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
