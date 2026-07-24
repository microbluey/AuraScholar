import type { CanvasEdge, CanvasNode, CanvasWorkspaceDocument } from "@aurascholar/core";

export const CANVAS_HISTORY_LIMIT = 50;
export const CANVAS_HISTORY_MERGE_WINDOW_MS = 900;

export interface CanvasHistoryMutation {
  label: string;
  mergeKey?: string;
  mergeWindowMs?: number;
}

export interface CanvasDocumentChangeOptions {
  history?: CanvasHistoryMutation | false;
}

export interface CanvasHistorySnapshot {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
}

export interface CanvasHistoryEntry {
  label: string;
  mergeKey?: string;
  recordedAt: number;
  snapshot: CanvasHistorySnapshot;
}

export interface CanvasHistoryState {
  future: CanvasHistoryEntry[];
  past: CanvasHistoryEntry[];
  present: CanvasHistorySnapshot;
  presentFingerprint: string;
  workspaceId: string;
}

export interface CanvasHistoryCommandResult {
  document: CanvasWorkspaceDocument;
  history: CanvasHistoryState;
  label: string;
}

export function createCanvasHistoryState(document: CanvasWorkspaceDocument): CanvasHistoryState {
  return {
    workspaceId: document.workspaceId,
    present: canvasHistorySnapshot(document),
    presentFingerprint: "",
    past: [],
    future: [],
  };
}

function canvasHistorySnapshot(document: CanvasWorkspaceDocument): CanvasHistorySnapshot {
  return {
    nodes: document.nodes,
    edges: document.edges,
  };
}

function canonicalizeCanvasHistoryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeCanvasHistoryValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeCanvasHistoryValue(child)]),
  );
}

function canvasHistorySnapshotFingerprint(snapshot: CanvasHistorySnapshot): string {
  const nodes = snapshot.nodes.map((node) => {
    const { updatedAt: _updatedAt, ...rest } = node;
    if (node.type !== "group") return rest;
    const { collapsed: _collapsed, ...data } = node.data;
    return { ...rest, data };
  });
  const edges = snapshot.edges.map(({ updatedAt: _updatedAt, ...edge }) => edge);
  return JSON.stringify(canonicalizeCanvasHistoryValue({ nodes, edges }));
}

function canvasHistoryFingerprint(document: CanvasWorkspaceDocument): string {
  return canvasHistorySnapshotFingerprint(canvasHistorySnapshot(document));
}

export function reconcileCanvasHistory(
  history: CanvasHistoryState | undefined,
  document: CanvasWorkspaceDocument,
): CanvasHistoryState {
  if (
    history?.workspaceId === document.workspaceId &&
    history.present.nodes === document.nodes &&
    history.present.edges === document.edges
  ) {
    return history;
  }
  if (history?.workspaceId === document.workspaceId) {
    const expectedFingerprint =
      history.presentFingerprint || canvasHistorySnapshotFingerprint(history.present);
    const currentFingerprint = canvasHistoryFingerprint(document);
    if (expectedFingerprint === currentFingerprint) {
      return {
        ...history,
        present: canvasHistorySnapshot(document),
        presentFingerprint: currentFingerprint,
      };
    }
  }
  return createCanvasHistoryState(document);
}

export function sealCanvasHistory(history: CanvasHistoryState): CanvasHistoryState {
  const last = history.past.at(-1);
  const presentFingerprint =
    history.presentFingerprint || canvasHistorySnapshotFingerprint(history.present);
  if (!last?.mergeKey) {
    return history.presentFingerprint ? history : { ...history, presentFingerprint };
  }
  const { mergeKey: _mergeKey, ...sealed } = last;
  return {
    ...history,
    past: [...history.past.slice(0, -1), sealed],
    presentFingerprint,
  };
}

function applyCanvasHistorySnapshot(
  document: CanvasWorkspaceDocument,
  snapshot: CanvasHistorySnapshot,
  timestamp: number,
): CanvasWorkspaceDocument {
  const currentGroups = new Map(
    document.nodes.filter((node) => node.type === "group").map((node) => [node.id, node] as const),
  );
  return {
    ...document,
    nodes: snapshot.nodes.map((node) => {
      if (node.type !== "group") return node;
      const current = currentGroups.get(node.id);
      if (!current || current.data.collapsed === node.data.collapsed) return node;
      const { collapsed: _collapsed, ...data } = node.data;
      return {
        ...node,
        data:
          current.data.collapsed === undefined
            ? data
            : { ...data, collapsed: current.data.collapsed },
        updatedAt: Math.max(node.updatedAt, current.updatedAt),
      };
    }),
    edges: [...snapshot.edges],
    updatedAt: timestamp,
  };
}

export function canvasHistoryContentChanged(
  before: CanvasWorkspaceDocument,
  after: CanvasWorkspaceDocument,
): boolean {
  return (
    before.workspaceId === after.workspaceId &&
    (before.nodes !== after.nodes || before.edges !== after.edges)
  );
}

function normalizedMutation(
  mutation: CanvasHistoryMutation,
): Required<Pick<CanvasHistoryMutation, "label" | "mergeWindowMs">> &
  Pick<CanvasHistoryMutation, "mergeKey"> {
  const label = mutation.label.trim() || "编辑白板";
  const requestedWindow = mutation.mergeWindowMs ?? CANVAS_HISTORY_MERGE_WINDOW_MS;
  const mergeWindowMs = Number.isFinite(requestedWindow)
    ? Math.max(0, requestedWindow)
    : Number.POSITIVE_INFINITY;
  return {
    label,
    mergeWindowMs,
    ...(mutation.mergeKey ? { mergeKey: mutation.mergeKey } : {}),
  };
}

export function recordCanvasHistory(
  history: CanvasHistoryState | undefined,
  before: CanvasWorkspaceDocument,
  after: CanvasWorkspaceDocument,
  mutation: CanvasHistoryMutation,
  timestamp = Date.now(),
): CanvasHistoryState {
  const currentHistory = reconcileCanvasHistory(history, before);
  if (!canvasHistoryContentChanged(before, after)) return currentHistory;

  const normalized = normalizedMutation(mutation);
  const last = currentHistory.past.at(-1);
  const canMerge =
    currentHistory.future.length === 0 &&
    Boolean(normalized.mergeKey) &&
    last !== undefined &&
    last?.mergeKey === normalized.mergeKey &&
    timestamp >= last.recordedAt &&
    timestamp - last.recordedAt <= normalized.mergeWindowMs;

  if (canMerge && last) {
    return {
      ...currentHistory,
      past: [
        ...currentHistory.past.slice(0, -1),
        {
          ...last,
          label: normalized.label,
          recordedAt: timestamp,
        },
      ],
      future: [],
      present: canvasHistorySnapshot(after),
      presentFingerprint: "",
    };
  }

  const entry: CanvasHistoryEntry = {
    snapshot: canvasHistorySnapshot(before),
    label: normalized.label,
    recordedAt: timestamp,
    ...(normalized.mergeKey ? { mergeKey: normalized.mergeKey } : {}),
  };
  return {
    ...currentHistory,
    past: [...currentHistory.past.slice(-(CANVAS_HISTORY_LIMIT - 1)), entry],
    future: [],
    present: canvasHistorySnapshot(after),
    presentFingerprint: "",
  };
}

export function undoCanvasHistory(
  history: CanvasHistoryState,
  document: CanvasWorkspaceDocument,
  timestamp = Date.now(),
): CanvasHistoryCommandResult | null {
  history = reconcileCanvasHistory(history, document);
  const entry = history.past.at(-1);
  if (!entry) return null;
  const nextDocument = applyCanvasHistorySnapshot(document, entry.snapshot, timestamp);

  return {
    document: nextDocument,
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [
        {
          snapshot: canvasHistorySnapshot(document),
          label: entry.label,
          recordedAt: timestamp,
        },
        ...history.future,
      ].slice(0, CANVAS_HISTORY_LIMIT),
      present: canvasHistorySnapshot(nextDocument),
      presentFingerprint: "",
    },
    label: entry.label,
  };
}

export function redoCanvasHistory(
  history: CanvasHistoryState,
  document: CanvasWorkspaceDocument,
  timestamp = Date.now(),
): CanvasHistoryCommandResult | null {
  history = reconcileCanvasHistory(history, document);
  const entry = history.future[0];
  if (!entry) return null;
  const nextDocument = applyCanvasHistorySnapshot(document, entry.snapshot, timestamp);

  return {
    document: nextDocument,
    history: {
      ...history,
      past: [
        ...history.past.slice(-(CANVAS_HISTORY_LIMIT - 1)),
        {
          snapshot: canvasHistorySnapshot(document),
          label: entry.label,
          recordedAt: timestamp,
        },
      ],
      future: history.future.slice(1),
      present: canvasHistorySnapshot(nextDocument),
      presentFingerprint: "",
    },
    label: entry.label,
  };
}
