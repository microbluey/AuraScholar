import { type SentinelState } from "@aurascholar/core";
import { newId, normalizeDoi } from "@aurascholar/db/ids";
import type { SentinelEventRow, SentinelTaskRow } from "../../services/sentinel-page-data";

const PREVIEW_NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const LIBRARY_ID = "library:preview-sentinel";

export const PREVIEW_SENTINEL_SCOPE_MESSAGE =
  "浏览器预览使用可重置的哨兵样例；新增、检查、暂停、删除和撤销会在本页模拟生效，真实检查和证据快照会在桌面应用中保存。";

function previewTask(input: {
  currentState: SentinelState;
  doi?: string | null;
  hintAuthor?: string | null;
  hintVenue?: string | null;
  id: string;
  nextOffsetDays: number;
  polledOffsetDays: number;
  status?: string;
  title: string;
  workId?: string | null;
}): SentinelTaskRow {
  const createdAt = PREVIEW_NOW - DAY * 21;
  return {
    id: input.id,
    library_id: LIBRARY_ID,
    work_id: input.workId ?? null,
    doi: input.doi ?? null,
    title: input.title,
    hint_venue: input.hintVenue ?? null,
    hint_author: input.hintAuthor ?? null,
    current_state: input.currentState,
    target_flags: "registered,online,in_issue,indexed_openalex,indexed_pubmed",
    poll_interval_s: 86_400,
    next_poll_at: PREVIEW_NOW + DAY * input.nextOffsetDays,
    last_polled_at: PREVIEW_NOW - DAY * input.polledOffsetDays,
    error_count: 0,
    last_error: null,
    status: input.status ?? "active",
    created_at: createdAt,
    updated_at: PREVIEW_NOW - DAY * input.polledOffsetDays,
    deleted_at: null,
  };
}

function previewEvent(
  taskId: string,
  fromState: SentinelState,
  toState: SentinelState,
  offsetDays: number,
  source: string,
): SentinelEventRow {
  return {
    id: `${taskId}-${toState}`,
    task_id: taskId,
    from_state: fromState,
    to_state: toState,
    evidence_json: JSON.stringify(
      {
        preview: true,
        source,
        detectedAt: new Date(PREVIEW_NOW - DAY * offsetDays).toISOString(),
        note: "浏览器预览样例证据；真实证据会在桌面应用中保存原始 API 快照。",
      },
      null,
      2,
    ),
    detected_at: PREVIEW_NOW - DAY * offsetDays,
    notified_at: PREVIEW_NOW - DAY * offsetDays,
  };
}

const TASKS: SentinelTaskRow[] = [
  previewTask({
    id: "preview-sentinel-attention",
    workId: "preview-attention",
    doi: "10.48550/arXiv.1706.03762",
    title: "Attention Is All You Need",
    currentState: "indexed_openalex",
    nextOffsetDays: 2,
    polledOffsetDays: 1,
  }),
  previewTask({
    id: "preview-sentinel-alphafold",
    workId: "preview-alphafold",
    doi: "10.1038/s41586-021-03819-2",
    title: "Highly accurate protein structure prediction with AlphaFold",
    currentState: "indexed_pubmed",
    nextOffsetDays: 14,
    polledOffsetDays: 3,
    status: "done",
  }),
  previewTask({
    id: "preview-sentinel-sam",
    workId: "preview-sam",
    title: "Segment Anything",
    hintVenue: "ICCV",
    hintAuthor: "Kirillov",
    currentState: "accepted",
    nextOffsetDays: -1,
    polledOffsetDays: 5,
  }),
];

const EVENTS = new Map<string, SentinelEventRow[]>([
  [
    "preview-sentinel-attention",
    [
      previewEvent("preview-sentinel-attention", "accepted", "registered", 18, "Crossref"),
      previewEvent("preview-sentinel-attention", "registered", "online", 16, "Crossref"),
      previewEvent("preview-sentinel-attention", "online", "in_issue", 9, "Crossref"),
      previewEvent("preview-sentinel-attention", "in_issue", "indexed_openalex", 1, "OpenAlex"),
    ],
  ],
  [
    "preview-sentinel-alphafold",
    [
      previewEvent("preview-sentinel-alphafold", "accepted", "registered", 20, "Crossref"),
      previewEvent("preview-sentinel-alphafold", "registered", "online", 17, "Crossref"),
      previewEvent("preview-sentinel-alphafold", "online", "in_issue", 12, "Crossref"),
      previewEvent("preview-sentinel-alphafold", "in_issue", "indexed_pubmed", 3, "PubMed"),
    ],
  ],
  ["preview-sentinel-sam", []],
]);

export function previewSentinelTasks(): SentinelTaskRow[] {
  return TASKS.map((task) => ({ ...task }));
}

export function previewSentinelEvents(): Map<string, SentinelEventRow[]> {
  return new Map(
    Array.from(EVENTS, ([taskId, events]) => [taskId, events.map((event) => ({ ...event }))]),
  );
}

export function createPreviewSentinelTask(input: {
  mode: "doi" | "title";
  doi: string;
  title: string;
  hintVenue: string;
  hintAuthor: string;
}): SentinelTaskRow {
  const now = Date.now();
  const normalizedDoi = input.mode === "doi" ? normalizeDoi(input.doi) : null;
  return {
    id: `preview-sentinel-custom-${newId()}`,
    library_id: LIBRARY_ID,
    work_id: null,
    doi: normalizedDoi,
    title: input.title.trim() || normalizedDoi || "新的预览监控",
    hint_venue: input.mode === "title" ? input.hintVenue.trim() || null : null,
    hint_author: input.mode === "title" ? input.hintAuthor.trim() || null : null,
    current_state: "accepted",
    target_flags: "registered,online,in_issue,indexed_openalex,indexed_pubmed",
    poll_interval_s: 86_400,
    next_poll_at: now,
    last_polled_at: null,
    error_count: 0,
    last_error: null,
    status: "active",
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

function nextPreviewState(state: SentinelState): SentinelState | null {
  if (state === "accepted") return "registered";
  if (state === "registered") return "online";
  if (state === "online") return "in_issue";
  if (state === "in_issue") return "indexed_openalex";
  return null;
}

function previewCheckEvent(
  taskId: string,
  fromState: SentinelState,
  toState: SentinelState,
  detectedAt: number,
): SentinelEventRow {
  return {
    id: `${taskId}-preview-check-${detectedAt}`,
    task_id: taskId,
    from_state: fromState,
    to_state: toState,
    evidence_json: JSON.stringify(
      {
        preview: true,
        source: "Preview check",
        detectedAt: new Date(detectedAt).toISOString(),
        note: "浏览器预览模拟检查结果；真实证据会在桌面应用中保存原始 API 快照。",
      },
      null,
      2,
    ),
    detected_at: detectedAt,
    notified_at: detectedAt,
  };
}

export function simulatePreviewPoll(
  tasks: SentinelTaskRow[],
  eventsByTask: Map<string, SentinelEventRow[]>,
  taskIds: string[],
): {
  changes: number;
  checked: number;
  eventsByTask: Map<string, SentinelEventRow[]>;
  tasks: SentinelTaskRow[];
} {
  const ids = new Set(taskIds);
  const now = Date.now();
  let checked = 0;
  let changes = 0;
  const nextEvents = new Map(
    Array.from(eventsByTask, ([taskId, events]) => [taskId, events.map((event) => ({ ...event }))]),
  );
  const nextTasks = tasks.map((task) => {
    if (!ids.has(task.id) || task.status !== "active") return task;
    checked += 1;
    const currentState = task.current_state as SentinelState;
    const nextState = nextPreviewState(currentState);
    const nextTask = {
      ...task,
      last_polled_at: now,
      next_poll_at: now + task.poll_interval_s * 1000,
      error_count: 0,
      last_error: null,
      updated_at: now,
    };
    if (!nextState) return nextTask;
    changes += 1;
    nextEvents.set(task.id, [
      ...(nextEvents.get(task.id) ?? []),
      previewCheckEvent(task.id, currentState, nextState, now),
    ]);
    return {
      ...nextTask,
      current_state: nextState,
      status: nextState.startsWith("indexed_") ? "done" : nextTask.status,
    };
  });
  return { changes, checked, eventsByTask: nextEvents, tasks: nextTasks };
}
