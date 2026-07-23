import type {
  AISynthesisType,
  CanvasEdge,
  CanvasNode,
  CanvasPoint,
  CanvasWorkspaceDocument,
} from "@aurascholar/core";
import { MAX_CANVAS_SYNTHESIS_SOURCES } from "@aurascholar/ai";
import { ArrowLeft, SidebarSimple } from "@phosphor-icons/react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type EdgeChange,
  type NodeChange,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { canvasNodeTypes, type CanvasFlowNode } from "./CanvasCards";
import { CanvasDock, type CanvasTool } from "./CanvasDock";
import { CanvasInspector } from "./CanvasInspector";
import { CANVAS_WORK_DRAG_TYPE, CanvasLibraryPanel } from "./CanvasLibraryPanel";
import {
  CanvasReaderDrawer,
  canvasReaderExcerptDragPayload,
  type CanvasReaderAnnotationPayload,
} from "./CanvasReaderDrawer";
import { CanvasWorkspaceSwitcher } from "./CanvasWorkspaceSwitcher";
import { canvasEdgeTypes, type RelationFlowEdge } from "./RelationEdge";
import {
  CANVAS_EXCERPT_DRAG_MIME,
  CanvasExcerptDropError,
  applyCanvasExcerptDrop,
  readCanvasExcerptDragPayload,
  serializeCanvasExcerptDragPayload,
  type CanvasExcerptDragPayload,
} from "./canvas-excerpt-dnd";
import {
  createAISynthNode,
  createCanvasId,
  createEdge,
  createGroupNode,
  createIdeaNoteNode,
  createPaperNode,
  isSynthesisSource,
  SYNTHESIS_LABELS,
  type CanvasLibraryWork,
} from "./model";
import { synthesizeCanvasSelection } from "./synthesis";
import type {
  CanvasWorkspaceActionResult,
  CanvasWorkspaceOption,
  CreateCanvasWorkspace,
} from "./workspace-controls";

interface CanvasWorkspaceProps {
  document: CanvasWorkspaceDocument;
  libraryLoading: boolean;
  onCreateWorkspace: CreateCanvasWorkspace;
  onDeleteWorkspace: (workspaceId: string) => CanvasWorkspaceActionResult;
  onDocumentChange: (
    updater: (current: CanvasWorkspaceDocument) => CanvasWorkspaceDocument,
  ) => void;
  onExit: () => void;
  onOpenExcerpt: (
    workId: string,
    annotationId?: string,
    pageIndex?: number,
    attachmentId?: string,
  ) => void;
  onOpenPaper: (workId: string) => void;
  onRenameWorkspace: (workspaceId: string, name: string) => CanvasWorkspaceActionResult;
  onSelectWorkspace: (workspaceId: string) => CanvasWorkspaceActionResult;
  persistenceLabel: string;
  works: CanvasLibraryWork[];
  workspaces: readonly CanvasWorkspaceOption[];
}

const COLLAPSED_GROUP_DIMENSIONS = { width: 260, height: 48 } as const;

interface CanvasReaderTarget {
  annotationId?: string;
  attachmentId?: string;
  fromExcerpt: boolean;
  pageIndex?: number;
  paperTitle: string;
  sourceNodeId?: string;
  workId: string;
}

function absoluteNodePosition(node: CanvasNode, allNodes: CanvasNode[]): CanvasPoint {
  if (!node.groupId) return node.position;
  const group = allNodes.find(
    (candidate) => candidate.id === node.groupId && candidate.type === "group",
  );
  if (!group) return node.position;
  return { x: group.position.x + node.position.x, y: group.position.y + node.position.y };
}

function nodeMiniMapColor(node: CanvasFlowNode): string {
  switch (node.type) {
    case "ai-synth":
      return "var(--color-ai)";
    case "excerpt":
      return "var(--color-warning)";
    case "idea-note":
      return "var(--color-accent-secondary)";
    case "group":
      return "var(--color-border-strong)";
    default:
      return "var(--color-accent)";
  }
}

function CanvasWorkspaceInner({
  document,
  libraryLoading,
  onCreateWorkspace,
  onDeleteWorkspace,
  onDocumentChange,
  onExit,
  onOpenExcerpt,
  onOpenPaper,
  onRenameWorkspace,
  onSelectWorkspace,
  persistenceLabel,
  works,
  workspaces,
}: CanvasWorkspaceProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(
    () => !window.matchMedia("(max-width: 980px)").matches,
  );
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [readerTarget, setReaderTarget] = useState<CanvasReaderTarget | null>(null);
  const trustedReaderPayloadRef = useRef<string | null>(null);
  const flow = useReactFlow<CanvasFlowNode, RelationFlowEdge>();

  const showNotice = useCallback((message: string) => setNotice(message), []);

  const closeReader = useCallback(() => {
    trustedReaderPayloadRef.current = null;
    setReaderTarget(null);
  }, []);

  const openInspector = useCallback(() => {
    if (readerTarget) return;
    setDrawerOpen(true);
  }, [readerTarget]);

  const openNodeInReader = useCallback(
    (node: CanvasNode) => {
      trustedReaderPayloadRef.current = null;
      if (node.type === "paper") {
        setReaderTarget({
          workId: node.data.workId,
          sourceNodeId: node.id,
          fromExcerpt: false,
          paperTitle: node.data.title,
        });
        setDrawerOpen(false);
        return;
      }
      if (node.type !== "excerpt") return;
      const source = document.nodes.find(
        (candidate) => candidate.type === "paper" && candidate.data.workId === node.data.workId,
      );
      setReaderTarget({
        workId: node.data.workId,
        sourceNodeId: source?.id,
        fromExcerpt: true,
        paperTitle: node.data.paperTitle,
        annotationId: node.data.annotationId,
        attachmentId: node.data.attachmentId,
        pageIndex: node.data.pageIndex,
      });
      setDrawerOpen(false);
    },
    [document.nodes],
  );

  const openWorkInReader = useCallback(
    (workId: string) => {
      const paper = document.nodes.find(
        (node) => node.type === "paper" && node.data.workId === workId,
      );
      if (paper) {
        openNodeInReader(paper);
        return;
      }
      onOpenPaper(workId);
    },
    [document.nodes, onOpenPaper, openNodeInReader],
  );

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const collapsedGroupIds = useMemo(
    () =>
      new Set(
        document.nodes
          .filter((node) => node.type === "group" && node.data.collapsed === true)
          .map((node) => node.id),
      ),
    [document.nodes],
  );
  const hiddenNodeProxyIds = useMemo(
    () =>
      new Map(
        document.nodes.flatMap((node) =>
          node.groupId && collapsedGroupIds.has(node.groupId)
            ? ([[node.id, node.groupId]] as const)
            : [],
        ),
      ),
    [collapsedGroupIds, document.nodes],
  );
  const hiddenNodeIds = useMemo(() => new Set(hiddenNodeProxyIds.keys()), [hiddenNodeProxyIds]);

  const setGroupCollapsed = useCallback(
    (groupId: string, collapsed: boolean) => {
      const group = document.nodes.find((node) => node.id === groupId && node.type === "group");
      const groupTitle = group?.type === "group" ? group.data.title : "未命名分组";
      const childCount = document.nodes.filter((node) => node.groupId === groupId).length;
      onDocumentChange((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === groupId && node.type === "group"
            ? {
                ...node,
                updatedAt: Date.now(),
                data: { ...node.data, collapsed },
              }
            : node,
        ),
        updatedAt: Date.now(),
      }));
      setSelectedNodeIds(new Set([groupId]));
      setSelectedEdgeId(null);
      openInspector();
      showNotice(
        collapsed
          ? `已折叠「${groupTitle}」，隐藏 ${childCount} 张卡片。`
          : `已展开「${groupTitle}」。`,
      );
    },
    [document.nodes, onDocumentChange, openInspector, showNotice],
  );

  const flowNodes = useMemo<CanvasFlowNode[]>(() => {
    const excerptCounts = new Map<string, number>();
    const groupChildCounts = new Map<string, number>();
    for (const node of document.nodes) {
      if (node.type === "excerpt") {
        excerptCounts.set(node.data.workId, (excerptCounts.get(node.data.workId) ?? 0) + 1);
      }
      if (node.groupId) {
        groupChildCounts.set(node.groupId, (groupChildCounts.get(node.groupId) ?? 0) + 1);
      }
    }
    const ordered = document.nodes
      .filter((node) => !hiddenNodeIds.has(node.id))
      .sort((a, b) => Number(b.type === "group") - Number(a.type === "group"));
    return ordered.map((storedNode) => {
      const node =
        storedNode.type === "paper"
          ? {
              ...storedNode,
              data: {
                ...storedNode.data,
                annotationCount: excerptCounts.get(storedNode.data.workId) ?? 0,
              },
            }
          : storedNode;
      const dimensions =
        node.type === "group" && node.data.collapsed ? COLLAPSED_GROUP_DIMENSIONS : node.dimensions;
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        parentId: node.groupId,
        extent: node.groupId ? "parent" : undefined,
        draggable: tool !== "pan",
        selectable: tool !== "pan",
        connectable: tool === "connect",
        selected: selectedNodeIds.has(node.id),
        zIndex: node.type === "group" ? 0 : 2,
        width: dimensions.width,
        height: dimensions.height,
        style: {
          width: dimensions.width,
          height: dimensions.height,
        },
        data: {
          canvasNode: node,
          groupChildCount: groupChildCounts.get(node.id) ?? 0,
          onOpenPaper: () => openNodeInReader(node),
          onOpenExcerpt: () => openNodeInReader(node),
          onToggleGroup: setGroupCollapsed,
        },
      };
    });
  }, [document.nodes, hiddenNodeIds, openNodeInReader, selectedNodeIds, setGroupCollapsed, tool]);

  const flowEdges = useMemo<RelationFlowEdge[]>(
    () =>
      document.edges
        .map((edge) => ({
          edge,
          source: hiddenNodeProxyIds.get(edge.sourceId) ?? edge.sourceId,
          target: hiddenNodeProxyIds.get(edge.targetId) ?? edge.targetId,
        }))
        .filter(({ source, target }) => source !== target)
        .map(({ edge, source, target }) => ({
          id: edge.id,
          source,
          target,
          type: "relation",
          data: { relationType: edge.relationType, label: edge.label },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          animated: edge.style?.animated,
          selected: selectedEdgeId === edge.id,
          style: {
            stroke: edge.style?.stroke || "var(--color-text-faint)",
            strokeWidth: selectedEdgeId === edge.id ? 2.2 : 1.45,
          },
        })),
    [document.edges, hiddenNodeProxyIds, selectedEdgeId],
  );

  const updateNode = useCallback(
    (node: CanvasNode) => {
      onDocumentChange((current) => ({
        ...current,
        nodes: current.nodes.map((candidate) => (candidate.id === node.id ? node : candidate)),
        updatedAt: Date.now(),
      }));
    },
    [onDocumentChange],
  );

  const updateEdge = useCallback(
    (edge: CanvasEdge) => {
      onDocumentChange((current) => ({
        ...current,
        edges: current.edges.map((candidate) => (candidate.id === edge.id ? edge : candidate)),
        updatedAt: Date.now(),
      }));
    },
    [onDocumentChange],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const selectionChanges = changes.filter(
        (change): change is Extract<NodeChange<CanvasFlowNode>, { type: "select" }> =>
          change.type === "select",
      );
      if (selectionChanges.length) {
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          for (const change of selectionChanges) {
            if (change.selected) next.add(change.id);
            else next.delete(change.id);
          }
          return next;
        });
        if (selectionChanges.some((change) => change.selected)) {
          setSelectedEdgeId(null);
          openInspector();
        }
      }
      const positions = new Map<string, CanvasPoint>();
      for (const change of changes) {
        if (change.type === "position" && change.position)
          positions.set(change.id, change.position);
      }
      if (!positions.size) return;
      onDocumentChange((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position, updatedAt: Date.now() } : node;
        }),
        updatedAt: Date.now(),
      }));
    },
    [onDocumentChange, openInspector],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationFlowEdge>[]) => {
      const selectionChanges = changes.filter(
        (change): change is Extract<EdgeChange<RelationFlowEdge>, { type: "select" }> =>
          change.type === "select",
      );
      if (!selectionChanges.length) return;
      const selected = selectionChanges.find((change) => change.selected);
      if (selected) {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(selected.id);
        openInspector();
        return;
      }
      setSelectedEdgeId((current) =>
        selectionChanges.some((change) => change.id === current) ? null : current,
      );
    },
    [openInspector],
  );

  const addPaper = useCallback(
    (work: CanvasLibraryWork, position?: CanvasPoint) => {
      if (document.nodes.some((node) => node.type === "paper" && node.data.workId === work.id)) {
        showNotice("这篇文献已经在当前画布中。");
        return;
      }
      const rect = wrapperRef.current?.getBoundingClientRect();
      const center =
        position ||
        flow.screenToFlowPosition({
          x: (rect?.left || 0) + (rect?.width || 900) * 0.46,
          y: (rect?.top || 0) + (rect?.height || 640) * 0.42,
        });
      const offset = document.nodes.filter((node) => node.type === "paper").length % 5;
      const node = createPaperNode(work, {
        x: center.x + offset * 24,
        y: center.y + offset * 20,
      });
      onDocumentChange((current) => ({
        ...current,
        nodes: [...current.nodes, node],
        updatedAt: Date.now(),
      }));
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId(null);
      openInspector();
      showNotice(`已将《${work.title}》加入画布。`);
    },
    [document.nodes, flow, onDocumentChange, openInspector, showNotice],
  );

  const addNote = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const position = flow.screenToFlowPosition({
      x: (rect?.left || 0) + (rect?.width || 900) * 0.5,
      y: (rect?.top || 0) + (rect?.height || 640) * 0.46,
    });
    const node = createIdeaNoteNode(position);
    onDocumentChange((current) => ({
      ...current,
      nodes: [...current.nodes, node],
      updatedAt: Date.now(),
    }));
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeId(null);
    openInspector();
  }, [flow, onDocumentChange, openInspector]);

  const groupSelected = useCallback(() => {
    const selected = document.nodes.filter(
      (node) => selectedNodeIds.has(node.id) && node.type !== "group" && !node.groupId,
    );
    if (selected.length < 2) return;
    const left = Math.min(...selected.map((node) => node.position.x));
    const top = Math.min(...selected.map((node) => node.position.y));
    const right = Math.max(...selected.map((node) => node.position.x + node.dimensions.width));
    const bottom = Math.max(...selected.map((node) => node.position.y + node.dimensions.height));
    const group = createGroupNode(
      { x: left - 34, y: top - 58 },
      { width: right - left + 68, height: bottom - top + 92 },
    );
    onDocumentChange((current) => ({
      ...current,
      nodes: [
        group,
        ...current.nodes.map((node) =>
          selectedNodeIds.has(node.id)
            ? {
                ...node,
                groupId: group.id,
                position: {
                  x: node.position.x - group.position.x,
                  y: node.position.y - group.position.y,
                },
                updatedAt: Date.now(),
              }
            : node,
        ),
      ],
      updatedAt: Date.now(),
    }));
    setSelectedNodeIds(new Set([group.id]));
    showNotice(`已将 ${selected.length} 张卡片编为一组。`);
  }, [document.nodes, onDocumentChange, selectedNodeIds, showNotice]);

  const ungroup = useCallback(
    (groupId: string) => {
      onDocumentChange((current) => {
        const group = current.nodes.find((node) => node.id === groupId && node.type === "group");
        if (!group) return current;
        return {
          ...current,
          nodes: current.nodes
            .filter((node) => node.id !== groupId)
            .map((node) =>
              node.groupId === groupId
                ? {
                    ...node,
                    groupId: undefined,
                    position: {
                      x: group.position.x + node.position.x,
                      y: group.position.y + node.position.y,
                    },
                    updatedAt: Date.now(),
                  }
                : node,
            ),
          edges: current.edges.filter(
            (edge) => edge.sourceId !== groupId && edge.targetId !== groupId,
          ),
          updatedAt: Date.now(),
        };
      });
      setSelectedNodeIds(new Set());
      showNotice("已解除分组，组内卡片均已保留。");
    },
    [onDocumentChange, showNotice],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const target = document.nodes.find((node) => node.id === nodeId);
      if (target?.type === "group") {
        ungroup(nodeId);
        return;
      }
      onDocumentChange((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== nodeId),
        edges: current.edges.filter((edge) => edge.sourceId !== nodeId && edge.targetId !== nodeId),
        updatedAt: Date.now(),
      }));
      setSelectedNodeIds(new Set());
      showNotice("卡片已从画布移除，原文献与批注未被删除。");
    },
    [document.nodes, onDocumentChange, showNotice, ungroup],
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      onDocumentChange((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== edgeId),
        updatedAt: Date.now(),
      }));
      setSelectedEdgeId(null);
      showNotice("关系连线已删除。");
    },
    [onDocumentChange, showNotice],
  );

  const connect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return;
      if (
        document.edges.some(
          (edge) => edge.sourceId === connection.source && edge.targetId === connection.target,
        )
      ) {
        showNotice("这两个方向已经存在一条关系。");
        return;
      }
      const edge = createEdge(connection.source, connection.target);
      onDocumentChange((current) => ({
        ...current,
        edges: [...current.edges, edge],
        updatedAt: Date.now(),
      }));
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(edge.id);
      openInspector();
    },
    [document.edges, onDocumentChange, openInspector, showNotice],
  );

  const synthesize = useCallback(
    async (synthType: AISynthesisType) => {
      const sources = document.nodes
        .filter((node) => selectedNodeIds.has(node.id))
        .filter(isSynthesisSource);
      if (sources.length < 2 || synthesisBusy) return;
      if (sources.length > MAX_CANVAS_SYNTHESIS_SOURCES) {
        showNotice(`一次最多合成 ${MAX_CANVAS_SYNTHESIS_SOURCES} 张文献或摘录卡片。`);
        return;
      }
      const absolute = sources.map((node) => ({
        node,
        position: absoluteNodePosition(node, document.nodes),
      }));
      const averageX = absolute.reduce((sum, item) => sum + item.position.x, 0) / absolute.length;
      const bottom = Math.max(
        ...absolute.map((item) => item.position.y + item.node.dimensions.height),
      );
      const synthNode = createAISynthNode(
        sources.map((node) => node.id),
        synthType,
        { x: averageX, y: bottom + 110 },
      );
      const sourceWorkspaceId = document.workspaceId;
      setSynthesisBusy(true);
      showNotice(`正在生成${SYNTHESIS_LABELS[synthType]}…`);
      try {
        const result = await synthesizeCanvasSelection({ sourceNodes: sources, synthType });
        const completedNode = {
          ...synthNode,
          data: {
            sourceNodeIds: result.sourceNodeIds,
            synthType: result.synthType,
            title: result.title,
            contentMarkdown: result.contentMarkdown,
            structuredTable: result.structuredTable,
            modelName: result.modelName,
          },
          updatedAt: Date.now(),
        };
        const provenanceEdges = sources.map((source) => ({
          ...createEdge(source.id, completedNode.id, "derived-from"),
          label: "合成来源",
        }));
        onDocumentChange((current) =>
          current.workspaceId !== sourceWorkspaceId
            ? current
            : {
                ...current,
                nodes: [...current.nodes, completedNode],
                edges: [...current.edges, ...provenanceEdges],
                updatedAt: Date.now(),
              },
        );
        setSelectedNodeIds(new Set([completedNode.id]));
        setSelectedEdgeId(null);
        openInspector();
        showNotice(result.preview ? "已生成未连接 AI 的交互预览。" : "AI 合成已完成。");
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI 合成暂时不可用";
        showNotice(message);
      } finally {
        setSynthesisBusy(false);
      }
    },
    [
      document.nodes,
      document.workspaceId,
      onDocumentChange,
      openInspector,
      selectedNodeIds,
      showNotice,
      synthesisBusy,
    ],
  );

  const addExcerptPayload = useCallback(
    (payload: CanvasExcerptDragPayload, position?: CanvasPoint): boolean => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const dropPosition =
        position ??
        flow.screenToFlowPosition({
          x: (rect?.left || 0) + (rect?.width || 900) * 0.52,
          y: (rect?.top || 0) + (rect?.height || 640) * 0.48,
        });
      const generatedIds = [createCanvasId(), createCanvasId()];
      const timestamp = Date.now();
      const applyDrop = (current: CanvasWorkspaceDocument) => {
        let idIndex = 0;
        return applyCanvasExcerptDrop(current, payload, dropPosition, {
          createId: () => generatedIds[idIndex++]!,
          now: () => timestamp,
        });
      };

      let planned: ReturnType<typeof applyCanvasExcerptDrop>;
      try {
        planned = applyDrop(document);
      } catch (error) {
        showNotice(
          error instanceof CanvasExcerptDropError ? error.message : "无法把这条高亮加入当前白板。",
        );
        return false;
      }

      onDocumentChange((current) => {
        try {
          const next = applyDrop(current).document;
          if (planned.createdNode || !planned.node.groupId) return next;
          return {
            ...next,
            nodes: next.nodes.map((node) =>
              node.id === planned.node.groupId && node.type === "group" && node.data.collapsed
                ? {
                    ...node,
                    data: { ...node.data, collapsed: false },
                    updatedAt: timestamp,
                  }
                : node,
            ),
            updatedAt: timestamp,
          };
        } catch {
          return current;
        }
      });
      setSelectedNodeIds(new Set([planned.node.id]));
      setSelectedEdgeId(null);
      if (!planned.createdNode) {
        const absolute = absoluteNodePosition(planned.node, planned.document.nodes);
        window.requestAnimationFrame(() => {
          void flow.setCenter(
            absolute.x + planned.node.dimensions.width / 2,
            absolute.y + planned.node.dimensions.height / 2,
            { duration: 240, zoom: Math.max(document.viewport.zoom, 0.8) },
          );
        });
      }
      showNotice(
        planned.createdNode
          ? "已创建摘录卡，并自动连接到来源文献。"
          : planned.createdEdge
            ? "摘录卡已存在，已补回来源连线。"
            : "这条高亮已在白板中，已为你定位。",
      );
      return true;
    },
    [document, flow, onDocumentChange, showNotice],
  );

  const rememberReaderAnnotation = useCallback(
    (payload: CanvasReaderAnnotationPayload): boolean => {
      const dragPayload = canvasReaderExcerptDragPayload(payload);
      if (
        !readerTarget ||
        dragPayload.workspaceId !== document.workspaceId ||
        dragPayload.sourceNodeId !== readerTarget.sourceNodeId ||
        dragPayload.workId !== readerTarget.workId
      ) {
        return false;
      }
      try {
        trustedReaderPayloadRef.current = serializeCanvasExcerptDragPayload(dragPayload);
      } catch {
        trustedReaderPayloadRef.current = null;
        return false;
      }
      return true;
    },
    [document.workspaceId, readerTarget],
  );

  const addReaderAnnotation = useCallback(
    (payload: CanvasReaderAnnotationPayload) => {
      const dragPayload = canvasReaderExcerptDragPayload(payload);
      if (!rememberReaderAnnotation(payload)) {
        showNotice("阅读会话已切换，本次加入已取消。");
        return false;
      }
      return addExcerptPayload(dragPayload);
    },
    [addExcerptPayload, rememberReaderAnnotation, showNotice],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (event.dataTransfer.types.includes(CANVAS_EXCERPT_DRAG_MIME)) {
        event.preventDefault();
        const excerptPayload = readCanvasExcerptDragPayload(
          event.dataTransfer,
          document.workspaceId,
        );
        if (!excerptPayload) {
          showNotice("摘录数据无效或白板已切换，本次拖入已取消。");
          return;
        }
        const trusted = trustedReaderPayloadRef.current;
        if (!trusted || serializeCanvasExcerptDragPayload(excerptPayload) !== trusted) {
          showNotice("无法验证这条摘录的阅读会话，本次拖入已取消。");
          return;
        }
        addExcerptPayload(
          excerptPayload,
          flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        );
        return;
      }

      if (!event.dataTransfer.types.includes(CANVAS_WORK_DRAG_TYPE)) return;
      event.preventDefault();
      const raw = event.dataTransfer.getData(CANVAS_WORK_DRAG_TYPE);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { id?: unknown };
        const work = works.find((candidate) => candidate.id === parsed.id);
        if (!work) return;
        addPaper(work, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      } catch {
        showNotice("无法读取拖入的文献。");
      }
    },
    [addExcerptPayload, addPaper, document.workspaceId, flow, showNotice, works],
  );

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
      onDocumentChange((current) => {
        if (
          Math.abs(current.viewport.x - viewport.x) < 0.01 &&
          Math.abs(current.viewport.y - viewport.y) < 0.01 &&
          Math.abs(current.viewport.zoom - viewport.zoom) < 0.0001
        ) {
          return current;
        }
        return { ...current, viewport, updatedAt: Date.now() };
      });
    },
    [onDocumentChange],
  );

  const selectedNode =
    selectedNodeIds.size === 1
      ? document.nodes.find((node) => selectedNodeIds.has(node.id)) || null
      : null;
  const selectedEdge = selectedEdgeId
    ? document.edges.find((edge) => edge.id === selectedEdgeId) || null
    : null;
  const selectedNodes = document.nodes.filter((node) => selectedNodeIds.has(node.id));
  const canGroup =
    selectedNodes.length >= 2 &&
    selectedNodes.every((node) => node.type !== "group" && !node.groupId);
  const synthesisSourceCount = selectedNodes.filter(isSynthesisSource).length;
  const addedWorkIds = new Set(
    document.nodes.filter((node) => node.type === "paper").map((node) => node.data.workId),
  );

  return (
    <div
      className={`canvas-workspace-split${readerTarget ? " canvas-workspace-split--reader-open" : ""}`}
    >
      <div
        className={`canvas-workspace canvas-workspace--tool-${tool}`}
        ref={wrapperRef}
        onDrop={onDrop}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes(CANVAS_WORK_DRAG_TYPE) ||
            event.dataTransfer.types.includes(CANVAS_EXCERPT_DRAG_MIME)
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
      >
        <ReactFlow<CanvasFlowNode, RelationFlowEdge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => {
            const additive = event.shiftKey || event.metaKey || event.ctrlKey;
            const next = additive ? new Set(selectedNodeIdsRef.current) : new Set<string>();
            if (additive && next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            setSelectedNodeIds(next);
            setSelectedEdgeId(null);
            openInspector();
          }}
          onConnect={connect}
          onMoveEnd={onMoveEnd}
          onNodeDoubleClick={(_event, node) => openNodeInReader(node.data.canvasNode)}
          onPaneClick={() => {
            setSelectedNodeIds(new Set());
            setSelectedEdgeId(null);
          }}
          defaultViewport={document.viewport}
          minZoom={0.2}
          maxZoom={2.4}
          panOnDrag={tool === "pan" ? true : [1, 2]}
          selectionOnDrag={tool === "select"}
          multiSelectionKeyCode="Shift"
          panActivationKeyCode="Space"
          nodesDraggable={tool !== "pan"}
          nodesConnectable={tool === "connect"}
          elementsSelectable={tool !== "pan"}
          deleteKeyCode={null}
          elevateNodesOnSelect
          colorMode="system"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1.25}
            color="var(--canvas-grid-dot)"
          />

          <div className="canvas-workspace__meta" aria-label="当前画布状态">
            <button type="button" onClick={onExit} aria-label="返回文献库" title="返回文献库">
              <ArrowLeft size={14} weight="bold" />
            </button>
            <CanvasWorkspaceSwitcher
              activeWorkspaceId={document.workspaceId}
              workspaces={workspaces}
              onSelectWorkspace={onSelectWorkspace}
              onCreateWorkspace={onCreateWorkspace}
              onDeleteWorkspace={onDeleteWorkspace}
              onRenameWorkspace={onRenameWorkspace}
            />
            <span>
              {document.nodes.length} 张卡片 · {document.edges.length} 条关系
            </span>
            <small>{persistenceLabel}</small>
          </div>

          <CanvasLibraryPanel
            works={works}
            loading={libraryLoading}
            addedWorkIds={addedWorkIds}
            onAddWork={addPaper}
          />

          <CanvasDock
            tool={tool}
            onToolChange={setTool}
            onZoomOut={() => void flow.zoomOut({ duration: 160 })}
            onZoomIn={() => void flow.zoomIn({ duration: 160 })}
            onFitView={() => void flow.fitView({ duration: 260, padding: 0.18 })}
            onAddNote={addNote}
            onGroup={groupSelected}
            onSynthesize={(type) => void synthesize(type)}
            canGroup={canGroup}
            canSynthesize={
              synthesisSourceCount >= 2 &&
              synthesisSourceCount <= MAX_CANVAS_SYNTHESIS_SOURCES &&
              !synthesisBusy
            }
            synthesisHint={
              synthesisSourceCount > MAX_CANVAS_SYNTHESIS_SOURCES
                ? `一次最多选择 ${MAX_CANVAS_SYNTHESIS_SOURCES} 张文献或摘录卡片`
                : synthesisSourceCount >= 2
                  ? "合成所选文献与摘录"
                  : "至少选择两张文献或摘录卡片"
            }
            selectedCount={selectedNodeIds.size}
          />

          <CanvasInspector
            open={drawerOpen && !readerTarget}
            onClose={() => setDrawerOpen(false)}
            node={selectedNode}
            edge={selectedEdge}
            groupChildCount={
              selectedNode?.type === "group"
                ? document.nodes.filter((node) => node.groupId === selectedNode.id).length
                : 0
            }
            selectedCount={selectedNodeIds.size}
            onUpdateNode={updateNode}
            onUpdateEdge={updateEdge}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onUngroup={ungroup}
            onSetGroupCollapsed={setGroupCollapsed}
            onOpenPaper={openWorkInReader}
            miniMap={
              <MiniMap<CanvasFlowNode>
                nodeColor={nodeMiniMapColor}
                nodeStrokeWidth={2}
                pannable
                zoomable
                maskColor="color-mix(in srgb, var(--color-bg) 78%, transparent)"
              />
            }
          />

          {!drawerOpen && !readerTarget && (
            <button
              className="canvas-inspector-toggle"
              type="button"
              onClick={openInspector}
              title="展开检查器"
              aria-label="展开画布检查器"
            >
              <SidebarSimple size={19} weight="duotone" />
            </button>
          )}

          {document.nodes.length === 0 && (
            <div className="canvas-empty">
              <strong>把第一篇文献放到研究空间</strong>
              <p>从左侧文献库点击或拖入文献，也可以先新建一张研究笔记。</p>
              <button type="button" onClick={addNote}>
                新建研究笔记
              </button>
            </div>
          )}
        </ReactFlow>
        <div className="canvas-live-notice" aria-live="polite" role="status">
          {notice}
        </div>
      </div>
      {readerTarget && (
        <CanvasReaderDrawer
          key={`${document.workspaceId}:${readerTarget.workId}:${readerTarget.attachmentId ?? ""}:${readerTarget.annotationId ?? ""}`}
          workspaceId={document.workspaceId}
          workId={readerTarget.workId}
          fallbackTitle={readerTarget.paperTitle}
          sourceNodeId={readerTarget.sourceNodeId}
          preferredAttachmentId={readerTarget.attachmentId}
          initialAnnotationId={readerTarget.annotationId}
          initialPageIndex={readerTarget.pageIndex}
          onClose={closeReader}
          onAnnotationReady={rememberReaderAnnotation}
          onAddAnnotation={addReaderAnnotation}
          onOpenFullReader={(target) => {
            if (readerTarget.fromExcerpt || target.annotationId) {
              onOpenExcerpt(
                target.workId,
                target.annotationId,
                target.pageIndex,
                target.attachmentId,
              );
              return;
            }
            onOpenPaper(target.workId);
          }}
        />
      )}
    </div>
  );
}

export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}
