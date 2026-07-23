import {
  applyCanvasLayout,
  planCanvasLayout,
  type AISynthesisType,
  type CanvasEdge,
  type CanvasLayoutFailure,
  type CanvasLayoutMode,
  type CanvasNode,
  type CanvasPoint,
  type CanvasWorkspaceDocument,
} from "@aurascholar/core";
import { MAX_CANVAS_SYNTHESIS_SOURCES } from "@aurascholar/ai";
import { ArrowLeft, Trash } from "@phosphor-icons/react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  NodeToolbar,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnConnectStartParams,
  useReactFlow,
  useStoreApi,
  useViewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { canvasNodeTypes, type CanvasFlowNode, type CanvasNodeMenuAnchor } from "./CanvasCards";
import { CanvasCommandPalette } from "./CanvasCommandPalette";
import { CanvasLinkTargetPicker, type CanvasLinkTargetRequest } from "./CanvasLinkTargetPicker";
import { CanvasNodeContextMenu } from "./CanvasNodeContextMenu";
import { CanvasDock, type CanvasTool } from "./CanvasDock";
import { CANVAS_WORK_DRAG_TYPE } from "./CanvasLibraryPanel";
import {
  CanvasReaderDrawer,
  canvasReaderExcerptDragPayload,
  type CanvasReaderAnnotationPayload,
} from "./CanvasReaderDrawer";
import { CanvasSelectionToolbar } from "./CanvasSelectionToolbar";
import { CanvasToolbox } from "./CanvasToolbox";
import { CanvasViewportControls } from "./CanvasViewportControls";
import { CanvasWorkspaceSwitcher } from "./CanvasWorkspaceSwitcher";
import { canvasEdgeTypes, type RelationFlowEdge } from "./RelationEdge";
import { SemanticLinkMenu } from "./SemanticLinkMenu";
import {
  CANVAS_INTERACTIVE_TARGET_SELECTOR,
  CANVAS_KEYBOARD_DELETE_BLOCKING_SELECTOR,
  applyCanvasSelectionDeletion,
  clampCanvasMenuPoint,
  isCanvasLayoutShortcut,
  isCanvasSelectionDeleteShortcut,
  planCanvasSelectionDeletion,
  primarySurfaceForCanvasNode,
  shouldActivateCanvasNode,
  type CanvasMenuPoint,
  type CanvasToolboxPanel,
} from "./canvas-interactions";
import { CANVAS_COMMAND_PALETTE_REQUEST_EVENT } from "./canvas-command";
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
  RELATION_LABELS,
  SYNTHESIS_LABELS,
  type CanvasLibraryWork,
} from "./model";
import {
  applySemanticLink,
  COLLAPSED_GROUP_DIMENSIONS,
  planSemanticLink,
  resolveSemanticLinkAnchor,
  resolveSemanticLinkHandles,
  type PendingSemanticLink,
  type QuickSemanticRelation,
} from "./semantic-link";
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
  searchWorks: (query: string) => Promise<CanvasLibraryWork[]>;
  works: CanvasLibraryWork[];
  workspaces: readonly CanvasWorkspaceOption[];
}

interface CanvasReaderTarget {
  annotationId?: string;
  attachmentId?: string;
  fromExcerpt: boolean;
  pageIndex?: number;
  paperTitle: string;
  sourceNodeId?: string;
  workId: string;
}

interface CanvasNodeMenuState {
  nodeId: string;
  position: CanvasMenuPoint;
  returnFocusElement: HTMLElement | null;
}

function readerTargetsNode(target: CanvasReaderTarget, node: CanvasNode): boolean {
  if (node.type === "paper") {
    return target.sourceNodeId === node.id || target.workId === node.data.workId;
  }
  return (
    node.type === "excerpt" &&
    target.fromExcerpt &&
    target.workId === node.data.workId &&
    target.annotationId === node.data.annotationId
  );
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

function semanticNodeLabel(node: CanvasNode): string {
  const compact = (value: string) =>
    value.length > 72 ? `${value.slice(0, 69).trimEnd()}…` : value;
  switch (node.type) {
    case "paper":
      return compact(node.data.title);
    case "excerpt":
      return `摘录《${node.data.paperTitle}》第 ${node.data.pageIndex + 1} 页`;
    case "ai-synth":
      return compact(node.data.title);
    case "idea-note":
      return compact(node.data.title || "未命名研究想法");
    case "group":
      return compact(node.data.title);
  }
}

function canvasLayoutFailureMessage(reason: CanvasLayoutFailure): string {
  switch (reason) {
    case "selection-too-small":
      return "请选择至少两张文献卡片后再整理。";
    case "mixed-node-types":
      return "自动整理目前仅支持文献卡片。";
    case "mixed-parent":
      return "请只选择画布根层级，或同一分组内的文献。";
    case "collapsed-parent-group":
      return "请先展开分组，再整理其中的文献。";
    case "no-citation-edges":
      return "所选文献之间还没有“引用”关系。";
    default:
      return "所选文献已发生变化，请重新选择后再试。";
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
  searchWorks,
  works,
  workspaces,
}: CanvasWorkspaceProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [toolboxPanel, setToolboxPanel] = useState<CanvasToolboxPanel | null>(null);
  const [autoFocusDetails, setAutoFocusDetails] = useState(false);
  const [nodeMenu, setNodeMenu] = useState<CanvasNodeMenuState | null>(null);
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [readerTarget, setReaderTarget] = useState<CanvasReaderTarget | null>(null);
  const [connectionInProgress, setConnectionInProgress] = useState(false);
  const [pendingSemanticLink, setPendingSemanticLink] = useState<PendingSemanticLink | null>(null);
  const [linkTargetRequest, setLinkTargetRequest] = useState<CanvasLinkTargetRequest | null>(null);
  const [semanticCommitConfirmation, setSemanticCommitConfirmation] = useState<{
    edge: CanvasEdge;
    pending: PendingSemanticLink;
    relationType: QuickSemanticRelation;
  } | null>(null);
  const [semanticLinkReturnFocus, setSemanticLinkReturnFocus] = useState<HTMLElement | null>(null);
  const cancelledConnectionRef = useRef(false);
  const completedConnectionRef = useRef(false);
  const connectionStartRef = useRef<{
    clientX?: number;
    clientY?: number;
    sourceHandle?: string;
    sourceId: string;
    workspaceId: string;
  } | null>(null);
  const linkTargetRequestRef = useRef<CanvasLinkTargetRequest | null>(null);
  const trustedReaderPayloadRef = useRef<string | null>(null);
  const commandAnchorRef = useRef<CanvasPoint | null>(null);
  const lastCanvasPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeWorkspaceIdRef = useRef(document.workspaceId);
  const flow = useReactFlow<CanvasFlowNode, RelationFlowEdge>();
  const flowStore = useStoreApi<CanvasFlowNode, RelationFlowEdge>();
  const viewport = useViewport();

  const showNotice = useCallback((message: string) => setNotice(message), []);

  const cancelFlowConnection = useCallback(() => {
    cancelledConnectionRef.current = true;
    completedConnectionRef.current = false;
    connectionStartRef.current = null;
    linkTargetRequestRef.current = null;
    flowStore.getState().cancelConnection();
    flowStore.setState({ connectionClickStartHandle: null });
    setConnectionInProgress(false);
    setLinkTargetRequest(null);
    setPendingSemanticLink(null);
  }, [flowStore]);

  const closeReader = useCallback(() => {
    trustedReaderPayloadRef.current = null;
    setReaderTarget(null);
  }, []);

  const dismissNodeMenu = useCallback((restoreFocus: boolean) => {
    setNodeMenu((current) => {
      if (restoreFocus && current?.returnFocusElement?.isConnected) {
        window.requestAnimationFrame(() => current.returnFocusElement?.focus());
      }
      return null;
    });
  }, []);

  const openCanvasCommand = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const lastPointer = lastCanvasPointerRef.current;
    const screenPoint =
      lastPointer &&
      lastPointer.x >= rect.left &&
      lastPointer.x <= rect.right &&
      lastPointer.y >= rect.top &&
      lastPointer.y <= rect.bottom
        ? lastPointer
        : {
            x: rect.left + rect.width * 0.5,
            y: rect.top + rect.height * 0.46,
          };
    commandAnchorRef.current = flow.screenToFlowPosition(screenPoint);
    cancelFlowConnection();
    dismissNodeMenu(false);
    setCommandOpen(true);
  }, [cancelFlowConnection, dismissNodeMenu, flow]);

  useEffect(() => {
    const toggleCanvasCommand = () => {
      if (commandOpen) {
        setCommandOpen(false);
        return;
      }
      openCanvasCommand();
    };
    window.addEventListener(CANVAS_COMMAND_PALETTE_REQUEST_EVENT, toggleCanvasCommand);
    return () =>
      window.removeEventListener(CANVAS_COMMAND_PALETTE_REQUEST_EVENT, toggleCanvasCommand);
  }, [commandOpen, openCanvasCommand]);

  const openNodeInReader = useCallback(
    (node: CanvasNode) => {
      trustedReaderPayloadRef.current = null;
      cancelFlowConnection();
      setNodeMenu(null);
      setToolboxPanel(null);
      setAutoFocusDetails(false);
      if (node.type === "paper") {
        setReaderTarget({
          workId: node.data.workId,
          sourceNodeId: node.id,
          fromExcerpt: false,
          paperTitle: node.data.title,
        });
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
    },
    [cancelFlowConnection, document.nodes],
  );

  const activateNode = useCallback(
    (node: CanvasNode) => {
      if (primarySurfaceForCanvasNode(node) === "reader") {
        openNodeInReader(node);
        return;
      }
      trustedReaderPayloadRef.current = null;
      cancelFlowConnection();
      setNodeMenu(null);
      closeReader();
      setAutoFocusDetails(false);
      setToolboxPanel("details");
    },
    [cancelFlowConnection, closeReader, openNodeInReader],
  );

  const activateNodeById = useCallback(
    (nodeId: string) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId(null);
      activateNode(node);
    },
    [activateNode, document.nodes],
  );

  const openNodeDetails = useCallback(
    (nodeId: string) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      trustedReaderPayloadRef.current = null;
      closeReader();
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId(null);
      setAutoFocusDetails(true);
      setToolboxPanel("details");
    },
    [closeReader, document.nodes],
  );

  const changeToolboxPanel = useCallback(
    (panel: CanvasToolboxPanel | null) => {
      dismissNodeMenu(false);
      setAutoFocusDetails(false);
      if (panel === "details") closeReader();
      setToolboxPanel(panel);
    },
    [closeReader, dismissNodeMenu],
  );

  const requestNodeContextMenu = useCallback(
    (nodeId: string, anchor: CanvasNodeMenuAnchor) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      cancelFlowConnection();
      if (!selectedNodeIdsRef.current.has(nodeId)) {
        setSelectedNodeIds(new Set([nodeId]));
      }
      setSelectedEdgeId(null);

      const wrapperRect = wrapper.getBoundingClientRect();
      const nodeRect = anchor.returnFocusElement
        .closest<HTMLElement>("[data-canvas-node-id]")
        ?.getBoundingClientRect();
      const clientX = anchor.clientX || nodeRect?.right || wrapperRect.left + 24;
      const clientY = anchor.clientY || nodeRect?.top || wrapperRect.top + 24;
      setNodeMenu({
        nodeId,
        position: clampCanvasMenuPoint(
          { x: clientX - wrapperRect.left, y: clientY - wrapperRect.top },
          { width: wrapperRect.width, height: wrapperRect.height },
          { width: 238, height: 392 },
        ),
        returnFocusElement: anchor.returnFocusElement,
      });
    },
    [cancelFlowConnection],
  );

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => {
    linkTargetRequestRef.current = linkTargetRequest;
  }, [linkTargetRequest]);

  useEffect(() => {
    if (activeWorkspaceIdRef.current === document.workspaceId) return;
    activeWorkspaceIdRef.current = document.workspaceId;
    trustedReaderPayloadRef.current = null;
    cancelledConnectionRef.current = true;
    completedConnectionRef.current = false;
    connectionStartRef.current = null;
    linkTargetRequestRef.current = null;
    flowStore.getState().cancelConnection();
    flowStore.setState({ connectionClickStartHandle: null });
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setNodeMenu(null);
    setConnectionInProgress(false);
    setLinkTargetRequest(null);
    setPendingSemanticLink(null);
    setSemanticCommitConfirmation(null);
    setSemanticLinkReturnFocus(null);
    setReaderTarget(null);
    setToolboxPanel(null);
    setAutoFocusDetails(false);
    setCommandOpen(false);
    commandAnchorRef.current = null;
    lastCanvasPointerRef.current = null;
  }, [document.workspaceId, flowStore]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3400);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!semanticCommitConfirmation) return;
    const committedEdge = document.edges.find(
      (edge) => edge.id === semanticCommitConfirmation.edge.id,
    );
    if (committedEdge) {
      const timeout = window.setTimeout(() => {
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(committedEdge.id);
        showNotice(`已创建“${committedEdge.label}”关系。`);
        setSemanticCommitConfirmation(null);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const validation = applySemanticLink(
      document,
      semanticCommitConfirmation.pending,
      semanticCommitConfirmation.relationType,
      semanticCommitConfirmation.edge,
    );
    if (validation.status === "created") return;
    const timeout = window.setTimeout(() => {
      if (validation.status === "duplicate") {
        const existing = document.edges.find(
          (edge) =>
            edge.sourceId === semanticCommitConfirmation.pending.sourceId &&
            edge.targetId === semanticCommitConfirmation.pending.targetId,
        );
        setSelectedNodeIds(new Set());
        setSelectedEdgeId(existing?.id ?? null);
      }
      showNotice(
        validation.status === "duplicate"
          ? "这两个方向已经存在一条关系。"
          : validation.status === "workspace-mismatch"
            ? "白板已切换，本次连线未写入。"
            : "连线端点已发生变化，请重试。",
      );
      setSemanticCommitConfirmation(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [document, semanticCommitConfirmation, showNotice]);

  useEffect(() => {
    if (!connectionInProgress || pendingSemanticLink) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        cancelFlowConnection();
        showNotice("已取消关系连线。");
      }
    };
    const cancelOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".react-flow__pane, .react-flow__handle.connectablestart")
      ) {
        return;
      }
      cancelFlowConnection();
      showNotice("已取消关系连线。");
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("pointerdown", cancelOnOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("pointerdown", cancelOnOutsidePointer, true);
    };
  }, [cancelFlowConnection, connectionInProgress, pendingSemanticLink, showNotice]);

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
      cancelFlowConnection();
      showNotice(
        collapsed
          ? `已折叠「${groupTitle}」，隐藏 ${childCount} 张卡片。`
          : `已展开「${groupTitle}」。`,
      );
    },
    [cancelFlowConnection, document.nodes, onDocumentChange, showNotice],
  );

  /* eslint-disable react-hooks/refs -- React Flow stores these callbacks as event handlers; it does not invoke them during render. */
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
        connectable: tool !== "pan" && !pendingSemanticLink && !linkTargetRequest,
        focusable: false,
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
          menuOpen: nodeMenu?.nodeId === node.id,
          onActivateNode: activateNodeById,
          onOpenPaper: () => openNodeInReader(node),
          onOpenExcerpt: () => openNodeInReader(node),
          onRequestContextMenu: requestNodeContextMenu,
          onToggleGroup: setGroupCollapsed,
        },
      };
    });
  }, [
    activateNodeById,
    document.nodes,
    hiddenNodeIds,
    nodeMenu?.nodeId,
    linkTargetRequest,
    openNodeInReader,
    pendingSemanticLink,
    requestNodeContextMenu,
    selectedNodeIds,
    setGroupCollapsed,
    tool,
  ]);
  /* eslint-enable react-hooks/refs */

  const flowEdges = useMemo<RelationFlowEdge[]>(
    () =>
      document.edges
        .map((edge) => ({
          edge,
          source: hiddenNodeProxyIds.get(edge.sourceId) ?? edge.sourceId,
          target: hiddenNodeProxyIds.get(edge.targetId) ?? edge.targetId,
        }))
        .filter(({ source, target }) => source !== target)
        .map(({ edge, source, target }) => {
          const handles = resolveSemanticLinkHandles(document.nodes, source, target);
          const sourceNode = document.nodes.find((node) => node.id === source);
          const targetNode = document.nodes.find((node) => node.id === target);
          return {
            id: edge.id,
            source,
            target,
            ariaLabel:
              sourceNode && targetNode
                ? `${semanticNodeLabel(sourceNode)} ${edge.label || RELATION_LABELS[edge.relationType]} ${semanticNodeLabel(targetNode)}`
                : undefined,
            sourceHandle: handles.sourceHandle,
            targetHandle: handles.targetHandle,
            type: "relation",
            data: { relationType: edge.relationType, label: edge.label },
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
            animated: edge.style?.animated,
            selected: selectedEdgeId === edge.id,
            style: {
              stroke: edge.style?.stroke || "var(--color-text-faint)",
              strokeWidth: selectedEdgeId === edge.id ? 2.2 : 1.45,
            },
          };
        }),
    [document.edges, document.nodes, hiddenNodeProxyIds, selectedEdgeId],
  );

  const displayedFlowEdges = useMemo<RelationFlowEdge[]>(() => {
    if (!pendingSemanticLink) return flowEdges;
    return [
      ...flowEdges,
      {
        id: "canvas:pending-semantic-link",
        source: pendingSemanticLink.sourceId,
        target: pendingSemanticLink.targetId,
        sourceHandle: pendingSemanticLink.sourceHandle,
        targetHandle: pendingSemanticLink.targetHandle,
        type: "relation",
        data: { relationType: "custom", pending: true },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        selectable: false,
        focusable: false,
        style: {
          stroke: "var(--color-accent)",
          strokeDasharray: "5 5",
          strokeWidth: 1.8,
        },
      },
    ];
  }, [flowEdges, pendingSemanticLink]);

  const linkTargetSourceAnchor = useMemo(
    () =>
      linkTargetRequest
        ? resolveSemanticLinkAnchor(
            document.nodes,
            linkTargetRequest.sourceId,
            linkTargetRequest.sourceHandle,
          )
        : null,
    [document.nodes, linkTargetRequest],
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
    [onDocumentChange],
  );

  const onEdgesChange = useCallback((changes: EdgeChange<RelationFlowEdge>[]) => {
    const selectionChanges = changes.filter(
      (change): change is Extract<EdgeChange<RelationFlowEdge>, { type: "select" }> =>
        change.type === "select",
    );
    if (!selectionChanges.length) return;
    const selected = selectionChanges.find((change) => change.selected);
    if (selected) {
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(selected.id);
      return;
    }
    setSelectedEdgeId((current) =>
      selectionChanges.some((change) => change.id === current) ? null : current,
    );
  }, []);

  const addPaper = useCallback(
    (work: CanvasLibraryWork, position?: CanvasPoint) => {
      if (document.nodes.some((node) => node.type === "paper" && node.data.workId === work.id)) {
        showNotice("这篇文献已经在当前画布中。");
        return null;
      }
      const rect = wrapperRef.current?.getBoundingClientRect();
      const center =
        position ||
        flow.screenToFlowPosition({
          x: (rect?.left || 0) + (rect?.width || 900) * 0.46,
          y: (rect?.top || 0) + (rect?.height || 640) * 0.42,
        });
      const offset = position
        ? 0
        : document.nodes.filter((node) => node.type === "paper").length % 5;
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
      showNotice(`已将《${work.title}》加入画布。`);
      return node.id;
    },
    [document.nodes, flow, onDocumentChange, showNotice],
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
    closeReader();
    setAutoFocusDetails(true);
    setToolboxPanel("details");
  }, [closeReader, flow, onDocumentChange]);

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
      cancelFlowConnection();
      showNotice("已解除分组，组内卡片均已保留。");
    },
    [cancelFlowConnection, onDocumentChange, showNotice],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const target = document.nodes.find((node) => node.id === nodeId);
      if (target?.type === "group") {
        ungroup(nodeId);
        return;
      }
      if (target && readerTarget && readerTargetsNode(readerTarget, target)) {
        closeReader();
      }
      onDocumentChange((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== nodeId),
        edges: current.edges.filter((edge) => edge.sourceId !== nodeId && edge.targetId !== nodeId),
        updatedAt: Date.now(),
      }));
      setSelectedNodeIds(new Set());
      cancelFlowConnection();
      showNotice("卡片已从画布移除，原文献与批注未被删除。");
    },
    [
      cancelFlowConnection,
      closeReader,
      document.nodes,
      onDocumentChange,
      readerTarget,
      showNotice,
      ungroup,
    ],
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

  const deleteSelection = useCallback(() => {
    const selectedTargets = document.nodes.filter((node) => selectedNodeIds.has(node.id));
    if (!selectedTargets.length && !selectedEdgeId) return;

    const { removedNodeIds, selectedGroupIds } = planCanvasSelectionDeletion(
      document,
      selectedNodeIds,
      selectedEdgeId,
    );
    onDocumentChange((current) =>
      applyCanvasSelectionDeletion(current, selectedNodeIds, selectedEdgeId),
    );

    if (
      readerTarget &&
      selectedTargets.some(
        (node) => removedNodeIds.has(node.id) && readerTargetsNode(readerTarget, node),
      )
    ) {
      closeReader();
    }
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setNodeMenu(null);
    setAutoFocusDetails(false);
    cancelFlowConnection();

    const messages = [
      removedNodeIds.size ? `移除 ${removedNodeIds.size} 张卡片` : "",
      selectedGroupIds.size ? `解除 ${selectedGroupIds.size} 个分组` : "",
      selectedEdgeId ? "删除 1 条连线" : "",
    ].filter(Boolean);
    showNotice(`${messages.join("，")}；文献库、PDF 与组内保留卡片未受影响。`);
  }, [
    cancelFlowConnection,
    closeReader,
    document,
    onDocumentChange,
    readerTarget,
    selectedEdgeId,
    selectedNodeIds,
    showNotice,
  ]);

  useEffect(() => {
    const handleDeleteShortcut = (event: KeyboardEvent) => {
      const wrapper = wrapperRef.current;
      const target = event.target instanceof Element ? event.target : null;
      const hasSelection = selectedNodeIds.size > 0 || Boolean(selectedEdgeId);
      if (
        !hasSelection ||
        !isCanvasSelectionDeleteShortcut({
          blockedSurface: Boolean(target?.closest(CANVAS_KEYBOARD_DELETE_BLOCKING_SELECTOR)),
          composing: event.isComposing,
          defaultPrevented: event.defaultPrevented,
          key: event.key,
          repeat: event.repeat,
          withinCanvas: Boolean(wrapper && target && wrapper.contains(target)),
        })
      ) {
        return;
      }
      event.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", handleDeleteShortcut);
    return () => window.removeEventListener("keydown", handleDeleteShortcut);
  }, [deleteSelection, selectedEdgeId, selectedNodeIds.size]);

  const connect = useCallback(
    (connection: Connection) => {
      if (cancelledConnectionRef.current) return;
      if (!connection.source || !connection.target) return;
      completedConnectionRef.current = true;
      const plan = planSemanticLink(document, connection.source, connection.target, {
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      if (plan.status !== "ready") {
        setPendingSemanticLink(null);
        if (plan.status === "duplicate") {
          const existing = document.edges.find(
            (edge) => edge.sourceId === connection.source && edge.targetId === connection.target,
          );
          setSelectedNodeIds(new Set());
          setSelectedEdgeId(existing?.id ?? null);
        }
        showNotice(
          plan.status === "duplicate"
            ? "这两个方向已经存在一条关系。"
            : plan.status === "self-link"
              ? "不能把卡片连接到自身。"
              : "连线端点已发生变化，请重试。",
        );
        return;
      }
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(null);
      setPendingSemanticLink(plan.pending);
    },
    [document, showNotice],
  );

  const cancelSemanticLink = useCallback(() => {
    cancelFlowConnection();
    showNotice("已取消关系连线。");
  }, [cancelFlowConnection, showNotice]);

  const commitSemanticLink = useCallback(
    (relationType: QuickSemanticRelation) => {
      if (!pendingSemanticLink) return;
      const result = applySemanticLink(document, pendingSemanticLink, relationType);
      setPendingSemanticLink(null);
      if (result.status !== "created") {
        showNotice(
          result.status === "duplicate"
            ? "这两个方向已经存在一条关系。"
            : result.status === "workspace-mismatch"
              ? "白板已切换，本次连线未写入。"
              : "连线端点已发生变化，请重试。",
        );
        return;
      }
      onDocumentChange(
        (current) =>
          applySemanticLink(current, pendingSemanticLink, relationType, result.edge).document,
      );
      setSemanticCommitConfirmation({
        edge: result.edge,
        pending: pendingSemanticLink,
        relationType,
      });
    },
    [document, onDocumentChange, pendingSemanticLink, showNotice],
  );

  const startSemanticConnection = useCallback(
    (event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      if (!params.nodeId) return;
      const touch = "touches" in event ? event.touches[0] : null;
      const clientX = touch?.clientX ?? ("clientX" in event ? event.clientX : null);
      const clientY = touch?.clientY ?? ("clientY" in event ? event.clientY : null);
      cancelledConnectionRef.current = false;
      completedConnectionRef.current = false;
      connectionStartRef.current = {
        sourceId: params.nodeId,
        ...(params.handleId ? { sourceHandle: params.handleId } : {}),
        ...(clientX === null ? {} : { clientX }),
        ...(clientY === null ? {} : { clientY }),
        workspaceId: document.workspaceId,
      };
      linkTargetRequestRef.current = null;
      setConnectionInProgress(true);
      setPendingSemanticLink(null);
      setLinkTargetRequest(null);
      const target = event.target;
      setSemanticLinkReturnFocus(
        target instanceof Element
          ? (target.closest(".react-flow__handle") as HTMLElement | null)
          : null,
      );
      showNotice("正在建立关系，请选择目标卡片。");
    },
    [document.workspaceId, showNotice],
  );

  const openLinkTargetAt = useCallback(
    (input: {
      clientX: number;
      clientY: number;
      sourceHandle?: string;
      sourceId: string;
      workspaceId: string;
    }) => {
      const wrapperBounds = wrapperRef.current?.getBoundingClientRect();
      if (
        !wrapperBounds ||
        input.clientX < wrapperBounds.left ||
        input.clientX > wrapperBounds.right ||
        input.clientY < wrapperBounds.top ||
        input.clientY > wrapperBounds.bottom ||
        input.workspaceId !== document.workspaceId ||
        input.workspaceId !== activeWorkspaceIdRef.current ||
        !document.nodes.some((node) => node.id === input.sourceId)
      ) {
        cancelFlowConnection();
        return false;
      }
      const request: CanvasLinkTargetRequest = {
        position: flow.screenToFlowPosition({ x: input.clientX, y: input.clientY }),
        sourceId: input.sourceId,
        workspaceId: input.workspaceId,
        ...(input.sourceHandle ? { sourceHandle: input.sourceHandle } : {}),
      };
      flowStore.getState().cancelConnection();
      flowStore.setState({ connectionClickStartHandle: null });
      connectionStartRef.current = null;
      linkTargetRequestRef.current = request;
      setConnectionInProgress(false);
      setLinkTargetRequest(request);
      setNodeMenu(null);
      setSelectedEdgeId(null);
      showNotice("在落点选择要连接的目标卡片。");
      return true;
    },
    [cancelFlowConnection, document.nodes, document.workspaceId, flow, flowStore, showNotice],
  );

  const finishSemanticConnection = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setConnectionInProgress(false);
      const start = connectionStartRef.current;
      connectionStartRef.current = null;
      const completedConnection = completedConnectionRef.current;
      completedConnectionRef.current = false;
      if (cancelledConnectionRef.current) return;
      const touch = "changedTouches" in event ? event.changedTouches[0] : null;
      const clientX = touch?.clientX ?? ("clientX" in event ? event.clientX : null);
      const clientY = touch?.clientY ?? ("clientY" in event ? event.clientY : null);
      if (clientX === null || clientY === null) return;
      // React Flow's click-connect end state may still contain the pre-click
      // connection snapshot. onConnect is the reliable success signal for both
      // click and drag gestures; toNode remains a defensive fallback.
      if (completedConnection || connectionState.toNode) {
        const position = flow.screenToFlowPosition({ x: clientX, y: clientY });
        setPendingSemanticLink((current) => (current ? { ...current, position } : current));
        return;
      }
      if (
        start?.clientX !== undefined &&
        start.clientY !== undefined &&
        Math.hypot(clientX - start.clientX, clientY - start.clientY) < 8
      ) {
        // A plain click on a handle begins React Flow's click-connect mode.
        // Its pointer lifecycle also reaches onConnectEnd, so leave the
        // subsequent click callback in charge instead of treating it as a drop.
        return;
      }
      const sourceId = connectionState.fromNode?.id ?? start?.sourceId;
      const sourceHandle = connectionState.fromHandle?.id ?? start?.sourceHandle;
      const sourceWorkspaceId = start?.workspaceId ?? document.workspaceId;
      if (!sourceId) {
        cancelFlowConnection();
        return;
      }
      openLinkTargetAt({
        clientX,
        clientY,
        sourceId,
        workspaceId: sourceWorkspaceId,
        ...(sourceHandle ? { sourceHandle } : {}),
      });
    },
    [cancelFlowConnection, document.workspaceId, flow, openLinkTargetAt],
  );

  const finishClickSemanticConnection = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setConnectionInProgress(false);
      connectionStartRef.current = null;
      const completedConnection = completedConnectionRef.current;
      completedConnectionRef.current = false;
      if (cancelledConnectionRef.current) return;
      const touch = "changedTouches" in event ? event.changedTouches[0] : null;
      const clientX = touch?.clientX ?? ("clientX" in event ? event.clientX : null);
      const clientY = touch?.clientY ?? ("clientY" in event ? event.clientY : null);
      if (clientX === null || clientY === null) return;
      if (completedConnection || connectionState.toNode) {
        const position = flow.screenToFlowPosition({ x: clientX, y: clientY });
        setPendingSemanticLink((current) => (current ? { ...current, position } : current));
        return;
      }
      cancelFlowConnection();
      showNotice("未连接到有效目标卡片。");
    },
    [cancelFlowConnection, flow, showNotice],
  );

  const cancelLinkTargetSelection = useCallback(() => {
    const returnFocusElement = semanticLinkReturnFocus;
    cancelFlowConnection();
    if (returnFocusElement?.isConnected) {
      window.requestAnimationFrame(() => returnFocusElement.focus({ preventScroll: true }));
    }
    showNotice("已取消关系连线。");
  }, [cancelFlowConnection, semanticLinkReturnFocus, showNotice]);

  const selectLinkTarget = useCallback(
    (targetId: string) => {
      const request = linkTargetRequestRef.current;
      if (
        !request ||
        request.workspaceId !== document.workspaceId ||
        request.workspaceId !== activeWorkspaceIdRef.current
      ) {
        cancelFlowConnection();
        showNotice("白板已切换，本次连线未写入。");
        return;
      }
      const source = document.nodes.find((node) => node.id === request.sourceId);
      const target = document.nodes.find((node) => node.id === targetId);
      if (!source || !target) {
        cancelFlowConnection();
        showNotice("连线端点已发生变化，请重试。");
        return;
      }
      const resolvedHandles = resolveSemanticLinkHandles(
        document.nodes,
        request.sourceId,
        targetId,
      );
      const plan = planSemanticLink(document, request.sourceId, targetId, {
        sourceHandle: request.sourceHandle ?? resolvedHandles.sourceHandle,
        targetHandle: resolvedHandles.targetHandle,
      });
      if (plan.status !== "ready") {
        cancelFlowConnection();
        if (plan.status === "duplicate") {
          const existing = document.edges.find(
            (edge) => edge.sourceId === request.sourceId && edge.targetId === targetId,
          );
          setSelectedNodeIds(new Set());
          setSelectedEdgeId(existing?.id ?? null);
        }
        showNotice(
          plan.status === "duplicate"
            ? "这两个方向已经存在一条关系。"
            : plan.status === "self-link"
              ? "不能把卡片连接到自身。"
              : "连线端点已发生变化，请重试。",
        );
        return;
      }
      if (target.groupId) {
        const collapsedParent = document.nodes.find(
          (node) =>
            node.id === target.groupId && node.type === "group" && node.data.collapsed === true,
        );
        if (collapsedParent) {
          onDocumentChange((current) => {
            if (current.workspaceId !== request.workspaceId) return current;
            return {
              ...current,
              nodes: current.nodes.map((node) =>
                node.id === collapsedParent.id && node.type === "group"
                  ? {
                      ...node,
                      data: { ...node.data, collapsed: false },
                      updatedAt: Date.now(),
                    }
                  : node,
              ),
              updatedAt: Date.now(),
            };
          });
        }
      }
      linkTargetRequestRef.current = null;
      setLinkTargetRequest(null);
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(null);
      setPendingSemanticLink({ ...plan.pending, position: request.position });
    },
    [cancelFlowConnection, document, onDocumentChange, showNotice],
  );

  const focusExistingLinkFromPicker = useCallback(
    (edgeId: string) => {
      const edge = document.edges.find((candidate) => candidate.id === edgeId);
      if (!edge) {
        cancelFlowConnection();
        showNotice("这条关系已发生变化，请重新选择目标。");
        return;
      }
      linkTargetRequestRef.current = null;
      setLinkTargetRequest(null);
      setSelectedNodeIds(new Set());
      setSelectedEdgeId(edge.id);
      closeReader();
      setAutoFocusDetails(false);
      setToolboxPanel("details");
      wrapperRef.current?.focus({ preventScroll: true });
      showNotice("已定位现有关系。");
    },
    [cancelFlowConnection, closeReader, document.edges, showNotice],
  );

  const changeTool = useCallback(
    (nextTool: CanvasTool) => {
      cancelFlowConnection();
      setTool(nextTool);
    },
    [cancelFlowConnection],
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
        if (activeWorkspaceIdRef.current !== sourceWorkspaceId) return;
        setSelectedNodeIds(new Set([completedNode.id]));
        setSelectedEdgeId(null);
        closeReader();
        setAutoFocusDetails(false);
        setToolboxPanel("details");
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
      closeReader,
      onDocumentChange,
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

  const focusNode = useCallback(
    (nodeId: string) => {
      const node = document.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;
      const collapsedParent = node.groupId
        ? document.nodes.find(
            (candidate) =>
              candidate.id === node.groupId &&
              candidate.type === "group" &&
              candidate.data.collapsed === true,
          )
        : undefined;
      if (collapsedParent?.type === "group") {
        onDocumentChange((current) => ({
          ...current,
          nodes: current.nodes.map((candidate) =>
            candidate.id === collapsedParent.id && candidate.type === "group"
              ? {
                  ...candidate,
                  data: { ...candidate.data, collapsed: false },
                  updatedAt: Date.now(),
                }
              : candidate,
          ),
          updatedAt: Date.now(),
        }));
        showNotice(`已展开「${collapsedParent.data.title}」并定位文献。`);
      }
      const position = absoluteNodePosition(node, document.nodes);
      setSelectedNodeIds(new Set([node.id]));
      setSelectedEdgeId(null);
      void flow.setCenter(
        position.x + node.dimensions.width / 2,
        position.y + node.dimensions.height / 2,
        { duration: 240, zoom: Math.max(document.viewport.zoom, 0.9) },
      );
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          wrapperRef.current
            ?.querySelector<HTMLElement>(`[data-canvas-node-id="${CSS.escape(node.id)}"]`)
            ?.focus();
        });
      });
    },
    [document.nodes, document.viewport.zoom, flow, onDocumentChange, showNotice],
  );

  const openNodeInFullReader = useCallback(
    (node: CanvasNode) => {
      if (node.type === "paper") {
        onOpenPaper(node.data.workId);
        return;
      }
      if (node.type !== "excerpt") return;
      onOpenExcerpt(
        node.data.workId,
        node.data.annotationId,
        node.data.pageIndex,
        node.data.attachmentId,
      );
    },
    [onOpenExcerpt, onOpenPaper],
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
  const canSynthesize =
    synthesisSourceCount >= 2 &&
    synthesisSourceCount <= MAX_CANVAS_SYNTHESIS_SOURCES &&
    !synthesisBusy;
  const synthesisHint =
    synthesisSourceCount > MAX_CANVAS_SYNTHESIS_SOURCES
      ? `一次最多选择 ${MAX_CANVAS_SYNTHESIS_SOURCES} 张文献或摘录卡片`
      : synthesisSourceCount >= 2
        ? "合成所选文献与摘录"
        : "至少选择两张文献或摘录卡片";
  const addedWorkIds = new Set(
    document.nodes.filter((node) => node.type === "paper").map((node) => node.data.workId),
  );
  const pendingSemanticSource = pendingSemanticLink
    ? document.nodes.find((node) => node.id === pendingSemanticLink.sourceId)
    : null;
  const pendingSemanticTarget = pendingSemanticLink
    ? document.nodes.find((node) => node.id === pendingSemanticLink.targetId)
    : null;
  const linkTargetSource = linkTargetRequest
    ? document.nodes.find((node) => node.id === linkTargetRequest.sourceId)
    : null;
  const nodeMenuTarget = nodeMenu
    ? document.nodes.find((node) => node.id === nodeMenu.nodeId) || null
    : null;
  const timelineLayoutPlan = useMemo(
    () => planCanvasLayout(document, selectedNodeIds, "timeline"),
    [document, selectedNodeIds],
  );
  const citationLayoutPlan = useMemo(
    () => planCanvasLayout(document, selectedNodeIds, "citation-tree"),
    [document, selectedNodeIds],
  );
  const canLayout = timelineLayoutPlan.status === "success";
  const canCitationLayout = citationLayoutPlan.status === "success";

  const applySelectedLayout = useCallback(
    (mode: CanvasLayoutMode) => {
      const plan = planCanvasLayout(document, selectedNodeIds, mode);
      if (plan.status === "error") {
        showNotice(canvasLayoutFailureMessage(plan.reason));
        return;
      }
      onDocumentChange((current) => applyCanvasLayout(current, plan));
      const focusNodeId = plan.nodePositions[0]?.nodeId;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const nodeElement = focusNodeId
            ? wrapperRef.current?.querySelector<HTMLElement>(
                `[data-canvas-node-id="${CSS.escape(focusNodeId)}"]`,
              )
            : null;
          (nodeElement ?? wrapperRef.current)?.focus({ preventScroll: true });
        });
      });
      showNotice(
        mode === "timeline"
          ? `已按发表年份整理 ${plan.nodePositions.length} 张文献。`
          : `已按引用关系整理 ${plan.nodePositions.length} 张文献。`,
      );
    },
    [document, onDocumentChange, selectedNodeIds, showNotice],
  );

  const openSelectionLayoutMenu = useCallback(() => {
    dismissNodeMenu(false);
    window.requestAnimationFrame(() => {
      const trigger = wrapperRef.current?.querySelector<HTMLButtonElement>(
        "[data-canvas-selection-layout-trigger='true']",
      );
      if (trigger) {
        trigger.click();
        return;
      }
      showNotice("请选择同一层级中的至少两张文献卡片。");
    });
  }, [dismissNodeMenu, showNotice]);

  useEffect(() => {
    const handleLayoutShortcut = (event: KeyboardEvent) => {
      const wrapper = wrapperRef.current;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !isCanvasLayoutShortcut({
          altKey: event.altKey,
          blockedSurface: Boolean(target?.closest(CANVAS_KEYBOARD_DELETE_BLOCKING_SELECTOR)),
          composing: event.isComposing,
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          key: event.key,
          metaKey: event.metaKey,
          repeat: event.repeat,
          shiftKey: event.shiftKey,
          withinCanvas: Boolean(wrapper && target && wrapper.contains(target)),
        })
      ) {
        return;
      }
      event.preventDefault();
      if (timelineLayoutPlan.status === "error") {
        showNotice(canvasLayoutFailureMessage(timelineLayoutPlan.reason));
        return;
      }
      openSelectionLayoutMenu();
    };
    window.addEventListener("keydown", handleLayoutShortcut);
    return () => window.removeEventListener("keydown", handleLayoutShortcut);
  }, [openSelectionLayoutMenu, showNotice, timelineLayoutPlan]);

  const addCommandWork = useCallback(
    (work: CanvasLibraryWork) => {
      const nodeId = addPaper(work, commandAnchorRef.current ?? undefined);
      if (!nodeId) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          wrapperRef.current
            ?.querySelector<HTMLElement>(`[data-canvas-node-id="${CSS.escape(nodeId)}"]`)
            ?.focus();
        });
      });
    },
    [addPaper],
  );

  const focusCommandWork = useCallback(
    (work: CanvasLibraryWork) => {
      const node = document.nodes.find(
        (candidate) => candidate.type === "paper" && candidate.data.workId === work.id,
      );
      if (!node) {
        showNotice("这篇文献已不在当前白板，请重新搜索后加入。");
        return;
      }
      focusNode(node.id);
    },
    [document.nodes, focusNode, showNotice],
  );

  return (
    <div
      className={`canvas-workspace-split${readerTarget ? " canvas-workspace-split--reader-open" : ""}`}
    >
      <div
        className={`canvas-workspace canvas-workspace--tool-${tool}${connectionInProgress ? " canvas-workspace--connecting" : ""}`}
        ref={wrapperRef}
        tabIndex={-1}
        onPointerMove={(event) => {
          if (event.target instanceof Element && event.target.closest(".react-flow__renderer")) {
            lastCanvasPointerRef.current = { x: event.clientX, y: event.clientY };
          }
        }}
        onPointerDownCapture={(event) => {
          const start = connectionStartRef.current;
          if (
            !start ||
            cancelledConnectionRef.current ||
            !(event.target instanceof Element) ||
            !event.target.closest(".react-flow__pane") ||
            event.target.closest(
              ".react-flow__node, .react-flow__edge, .react-flow__handle, [data-canvas-interactive]",
            )
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          openLinkTargetAt({
            clientX: event.clientX,
            clientY: event.clientY,
            sourceId: start.sourceId,
            workspaceId: start.workspaceId,
            ...(start.sourceHandle ? { sourceHandle: start.sourceHandle } : {}),
          });
        }}
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
          edges={displayedFlowEdges}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={28}
          connectionDragThreshold={8}
          connectOnClick
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => {
            const additive = event.shiftKey || event.metaKey || event.ctrlKey;
            const interactiveTarget =
              event.target instanceof Element &&
              Boolean(event.target.closest(CANVAS_INTERACTIVE_TARGET_SELECTOR));
            const activationIntent = {
              additive,
              button: event.button,
              connectionInProgress,
              interactiveTarget,
              pendingSemanticLink: Boolean(pendingSemanticLink || linkTargetRequest),
              tool,
            };
            if (additive) {
              if (
                tool !== "select" ||
                event.button !== 0 ||
                interactiveTarget ||
                connectionInProgress ||
                pendingSemanticLink ||
                linkTargetRequest
              ) {
                return;
              }
            } else if (!shouldActivateCanvasNode(activationIntent)) {
              return;
            }
            const next = additive ? new Set(selectedNodeIdsRef.current) : new Set<string>();
            if (additive && next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            setSelectedNodeIds(next);
            setSelectedEdgeId(null);
            setNodeMenu(null);
            if (!additive) activateNode(node.data.canvasNode);
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            event.stopPropagation();
            if (connectionInProgress || pendingSemanticLink || linkTargetRequest) {
              cancelFlowConnection();
              setNodeMenu(null);
              showNotice("已取消关系连线。");
              return;
            }
            if (tool !== "select") return;
            const returnFocusElement =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>("[data-canvas-node-id]")
                : null;
            if (!returnFocusElement) return;
            requestNodeContextMenu(node.id, {
              clientX: event.clientX,
              clientY: event.clientY,
              returnFocusElement,
            });
          }}
          onEdgeClick={(event, edge) => {
            if (
              tool !== "select" ||
              connectionInProgress ||
              pendingSemanticLink ||
              linkTargetRequest ||
              event.button !== 0
            ) {
              return;
            }
            setSelectedNodeIds(new Set());
            setSelectedEdgeId(edge.id);
            setNodeMenu(null);
            closeReader();
            setAutoFocusDetails(false);
            setToolboxPanel("details");
            wrapperRef.current?.focus({ preventScroll: true });
          }}
          onConnect={connect}
          onConnectStart={startSemanticConnection}
          onConnectEnd={finishSemanticConnection}
          onClickConnectStart={startSemanticConnection}
          onClickConnectEnd={finishClickSemanticConnection}
          onMoveEnd={onMoveEnd}
          onMoveStart={() => dismissNodeMenu(false)}
          onNodeDragStart={() => dismissNodeMenu(false)}
          onSelectionEnd={() => {
            window.requestAnimationFrame(() => wrapperRef.current?.focus({ preventScroll: true }));
          }}
          onPaneClick={(event) => {
            const start = connectionStartRef.current;
            if (start && !cancelledConnectionRef.current) {
              openLinkTargetAt({
                clientX: event.clientX,
                clientY: event.clientY,
                sourceId: start.sourceId,
                workspaceId: start.workspaceId,
                ...(start.sourceHandle ? { sourceHandle: start.sourceHandle } : {}),
              });
              return;
            }
            if (linkTargetRequestRef.current) return;
            cancelFlowConnection();
            dismissNodeMenu(false);
            setSelectedNodeIds(new Set());
            setSelectedEdgeId(null);
            wrapperRef.current?.focus({ preventScroll: true });
          }}
          defaultViewport={document.viewport}
          minZoom={0.2}
          maxZoom={2.4}
          panOnDrag={tool === "pan" ? true : [1]}
          selectionOnDrag={tool === "select"}
          multiSelectionKeyCode="Shift"
          panActivationKeyCode="Space"
          nodesDraggable={tool !== "pan"}
          nodesConnectable={tool !== "pan" && !pendingSemanticLink && !linkTargetRequest}
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

          <CanvasToolbox
            activePanel={toolboxPanel}
            autoFocusDetails={autoFocusDetails}
            works={works}
            libraryLoading={libraryLoading}
            addedWorkIds={addedWorkIds}
            onAddWork={addPaper}
            node={selectedNode}
            edge={selectedEdge}
            groupChildCount={
              selectedNode?.type === "group"
                ? document.nodes.filter((node) => node.groupId === selectedNode.id).length
                : 0
            }
            selectedCount={selectedNodeIds.size}
            onPanelChange={changeToolboxPanel}
            onActivateNode={activateNode}
            onUpdateNode={updateNode}
            onUpdateEdge={updateEdge}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
            onUngroup={ungroup}
            onSetGroupCollapsed={setGroupCollapsed}
          />

          <CanvasDock
            activePanel={toolboxPanel}
            tool={tool}
            onPanelChange={changeToolboxPanel}
            onToolChange={changeTool}
            onOpenCommand={openCanvasCommand}
            onAddNote={addNote}
          />

          {selectedNodeIds.size >= 2 && (
            <NodeToolbar
              nodeId={[...selectedNodeIds]}
              isVisible
              offset={14}
              className="canvas-selection-toolbar-anchor"
            >
              <CanvasSelectionToolbar
                className="nodrag nopan nowheel"
                selectedCount={selectedNodeIds.size}
                canGroup={canGroup}
                canLayout={canLayout}
                canCitationLayout={canCitationLayout}
                canSynthesize={canSynthesize}
                synthesisHint={synthesisHint}
                onGroup={groupSelected}
                onLayout={applySelectedLayout}
                onSynthesize={(type) => void synthesize(type)}
                moreActions={[
                  {
                    id: "delete-selection",
                    label: "从画布移除",
                    description: "不删除文献库论文或 PDF",
                    danger: true,
                    icon: <Trash size={17} weight="duotone" />,
                    onSelect: deleteSelection,
                  },
                ]}
              />
            </NodeToolbar>
          )}

          <CanvasViewportControls
            nodeCount={document.nodes.length}
            edgeCount={document.edges.length}
            onZoomOut={() => void flow.zoomOut({ duration: 160 })}
            onZoomIn={() => void flow.zoomIn({ duration: 160 })}
            onResetZoom={() => void flow.zoomTo(1, { duration: 180 })}
            onFitView={() => void flow.fitView({ duration: 260, padding: 0.18 })}
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

          {document.nodes.length === 0 && (
            <div className="canvas-empty">
              <strong>把第一篇文献放到研究空间</strong>
              <p>打开文献库拖入论文，或按 ⌘/Ctrl + K 搜索加入；也可以先新建研究笔记。</p>
              <button type="button" onClick={addNote}>
                新建研究笔记
              </button>
            </div>
          )}
        </ReactFlow>
        {linkTargetRequest && linkTargetSourceAnchor && (
          <svg className="canvas-link-target-preview" aria-hidden="true">
            <line
              x1={linkTargetSourceAnchor.x * viewport.zoom + viewport.x}
              y1={linkTargetSourceAnchor.y * viewport.zoom + viewport.y}
              x2={linkTargetRequest.position.x * viewport.zoom + viewport.x}
              y2={linkTargetRequest.position.y * viewport.zoom + viewport.y}
            />
            <circle
              cx={linkTargetRequest.position.x * viewport.zoom + viewport.x}
              cy={linkTargetRequest.position.y * viewport.zoom + viewport.y}
              r={5}
            />
          </svg>
        )}
        {linkTargetRequest && linkTargetSource && (
          <CanvasLinkTargetPicker
            document={document}
            request={linkTargetRequest}
            sourceLabel={semanticNodeLabel(linkTargetSource)}
            onCancel={cancelLinkTargetSelection}
            onSelect={selectLinkTarget}
            onFocusExistingEdge={focusExistingLinkFromPicker}
          />
        )}
        {pendingSemanticLink && pendingSemanticSource && pendingSemanticTarget && (
          <SemanticLinkMenu
            pending={pendingSemanticLink}
            sourceLabel={semanticNodeLabel(pendingSemanticSource)}
            targetLabel={semanticNodeLabel(pendingSemanticTarget)}
            returnFocusElement={semanticLinkReturnFocus}
            onCancel={cancelSemanticLink}
            onSelect={commitSemanticLink}
          />
        )}
        {nodeMenu && nodeMenuTarget && (
          <CanvasNodeContextMenu
            node={nodeMenuTarget}
            position={nodeMenu.position}
            canArrangeSelection={canLayout}
            canGroupSelection={canGroup}
            onClose={dismissNodeMenu}
            onActivate={activateNode}
            onOpenDetails={openNodeDetails}
            onOpenFullReader={openNodeInFullReader}
            onOpenLayoutMenu={openSelectionLayoutMenu}
            onGroupSelection={groupSelected}
            onSetGroupCollapsed={setGroupCollapsed}
            onUngroup={ungroup}
            onFocusNode={focusNode}
            onRemoveNode={deleteNode}
          />
        )}
        {commandOpen && (
          <CanvasCommandPalette
            addedWorkIds={addedWorkIds}
            canSynthesize={canSynthesize}
            onAddWork={addCommandWork}
            onClose={() => setCommandOpen(false)}
            onFocusWork={focusCommandWork}
            onSynthesize={(type) => void synthesize(type)}
            open
            searchWorks={searchWorks}
            synthesisHint={synthesisHint}
            works={works}
          />
        )}
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
