import type { AISynthesisType } from "@aurascholar/core";
import type { CanvasLibraryWork } from "./model";

export const CANVAS_COMMAND_COMMON_LIMIT = 6;
export const CANVAS_COMMAND_SEARCH_LIMIT = 30;
export const CANVAS_COMMAND_PALETTE_REQUEST_EVENT = "aurascholar:open-canvas-command-palette";

const SYNTHESIS_COMMANDS = [
  {
    description: "把所选文献与摘录整理为结构化方法对比表。",
    keywords: ["methodology", "matrix", "方法", "方法论", "对比", "矩阵"],
    label: "方法论矩阵",
    synthesisType: "methodology_matrix",
  },
  {
    description: "比较来源之间的支持、限定、分歧与冲突。",
    keywords: ["contradiction", "conflict", "冲突", "分歧", "观点", "支持"],
    label: "观点支持与冲突",
    synthesisType: "contradiction_analysis",
  },
  {
    description: "提炼证据缺口、研究空白与下一步问题。",
    keywords: ["gap", "research gap", "缺口", "空白", "问题"],
    label: "研究缺口",
    synthesisType: "research_gap",
  },
  {
    description: "生成所选材料的共同主线、独特贡献与限制。",
    keywords: ["tldr", "summary", "综述", "总结", "核心"],
    label: "核心综述",
    synthesisType: "tldr",
  },
] as const satisfies readonly {
  description: string;
  keywords: readonly string[];
  label: string;
  synthesisType: AISynthesisType;
}[];

export interface CanvasWorkCommandItem {
  added: boolean;
  description: string;
  group: "常用论文" | "文献搜索";
  id: string;
  kind: "work";
  title: string;
  work: CanvasLibraryWork;
}

export interface CanvasSynthesisCommandItem {
  description: string;
  disabled: boolean;
  disabledReason?: string;
  group: "AI 合成";
  id: string;
  kind: "synthesis";
  synthesisType: AISynthesisType;
  title: string;
}

export type CanvasCommandItem = CanvasWorkCommandItem | CanvasSynthesisCommandItem;

export interface BuildCanvasCommandItemsInput {
  addedWorkIds: ReadonlySet<string>;
  canSynthesize: boolean;
  commonLimit?: number;
  commonWorkIds?: readonly string[];
  prefilteredSearchResults?: boolean;
  query: string;
  searchLimit?: number;
  synthesisHint?: string;
  works: readonly CanvasLibraryWork[];
}

export interface CanvasCommandKeyInput {
  altKey?: boolean;
  composing?: boolean;
  ctrlKey?: boolean;
  currentIndex: number;
  itemCount: number;
  key: string;
  metaKey?: boolean;
  repeat?: boolean;
}

export interface CanvasCommandKeyResult {
  action?: "activate" | "close";
  handled: boolean;
  nextIndex: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function isCanvasAiCommandQuery(query: string): boolean {
  return normalize(query).startsWith("/ai");
}

function workDescription(work: CanvasLibraryWork): string {
  return [work.authorNames.join(", "), work.year ? String(work.year) : "", work.venue ?? ""]
    .filter(Boolean)
    .join(" · ");
}

function toWorkCommandItem(
  work: CanvasLibraryWork,
  group: CanvasWorkCommandItem["group"],
  addedWorkIds: ReadonlySet<string>,
): CanvasWorkCommandItem {
  return {
    added: addedWorkIds.has(work.id),
    description: workDescription(work) || "元数据待补全",
    group,
    id: `work:${work.id}`,
    kind: "work",
    title: work.title,
    work,
  };
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function commonWorks(
  works: readonly CanvasLibraryWork[],
  commonWorkIds: readonly string[] | undefined,
  limit: number,
): CanvasLibraryWork[] {
  if (limit === 0) return [];
  const byId = new Map(works.map((work) => [work.id, work] as const));
  const selected: CanvasLibraryWork[] = [];
  const selectedIds = new Set<string>();

  for (const id of commonWorkIds ?? []) {
    const work = byId.get(id);
    if (!work || selectedIds.has(id)) continue;
    selected.push(work);
    selectedIds.add(id);
    if (selected.length === limit) return selected;
  }

  for (const work of works) {
    if (selectedIds.has(work.id)) continue;
    selected.push(work);
    selectedIds.add(work.id);
    if (selected.length === limit) break;
  }
  return selected;
}

function fieldMatchScore(field: string, token: string, weight: number): number | null {
  if (!field) return null;
  if (field === token) return weight + 40;
  if (field.startsWith(token)) return weight + 24;
  const wordBoundary = field.search(new RegExp(`(^|\\s)${escapeRegExp(token)}`));
  if (wordBoundary >= 0) return weight + 14;
  if (field.includes(token)) return weight;
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreWork(work: CanvasLibraryWork, tokens: readonly string[]): number | null {
  const fields = [
    { value: normalize(work.title), weight: 100 },
    { value: normalize(work.authorNames.join(" ")), weight: 70 },
    { value: normalize(work.venue ?? ""), weight: 48 },
    { value: normalize(work.tags?.join(" ") ?? ""), weight: 44 },
    { value: work.year ? String(work.year) : "", weight: 36 },
  ];
  let score = 0;

  for (const token of tokens) {
    let tokenScore: number | null = null;
    for (const field of fields) {
      const candidate = fieldMatchScore(field.value, token, field.weight);
      if (candidate !== null && (tokenScore === null || candidate > tokenScore)) {
        tokenScore = candidate;
      }
    }
    if (tokenScore === null) return null;
    score += tokenScore;
  }
  return score;
}

function searchWorks(
  works: readonly CanvasLibraryWork[],
  query: string,
  limit: number,
): CanvasLibraryWork[] {
  if (limit === 0) return [];
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];

  return works
    .map((work, index) => ({ index, score: scoreWork(work, tokens), work }))
    .filter(
      (result): result is { index: number; score: number; work: CanvasLibraryWork } =>
        result.score !== null,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((result) => result.work);
}

function synthesisItems(
  canSynthesize: boolean,
  synthesisHint?: string,
): CanvasSynthesisCommandItem[] {
  return SYNTHESIS_COMMANDS.map((command) => ({
    description: command.description,
    disabled: !canSynthesize,
    ...(!canSynthesize
      ? { disabledReason: synthesisHint?.trim() || "当前选择不足，暂时无法执行 AI 合成。" }
      : {}),
    group: "AI 合成",
    id: `synthesis:${command.synthesisType}`,
    kind: "synthesis",
    synthesisType: command.synthesisType,
    title: command.label,
  }));
}

export function buildCanvasCommandItems({
  addedWorkIds,
  canSynthesize,
  commonLimit,
  commonWorkIds,
  prefilteredSearchResults = false,
  query,
  searchLimit,
  synthesisHint,
  works,
}: BuildCanvasCommandItemsInput): CanvasCommandItem[] {
  if (isCanvasAiCommandQuery(query)) {
    return synthesisItems(canSynthesize, synthesisHint);
  }

  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return commonWorks(
      works,
      commonWorkIds,
      boundedLimit(commonLimit, CANVAS_COMMAND_COMMON_LIMIT),
    ).map((work) => toWorkCommandItem(work, "常用论文", addedWorkIds));
  }

  const limit = boundedLimit(searchLimit, CANVAS_COMMAND_SEARCH_LIMIT);
  const matchingWorks = prefilteredSearchResults
    ? works.slice(0, limit)
    : searchWorks(works, normalizedQuery, limit);
  return matchingWorks.map((work) => toWorkCommandItem(work, "文献搜索", addedWorkIds));
}

export function clampCanvasCommandIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), itemCount - 1);
}

export function resolveCanvasCommandKey({
  altKey,
  composing,
  ctrlKey,
  currentIndex,
  itemCount,
  key,
  metaKey,
  repeat,
}: CanvasCommandKeyInput): CanvasCommandKeyResult {
  const nextIndex = clampCanvasCommandIndex(currentIndex, itemCount);
  if (composing || altKey || ctrlKey || metaKey) return { handled: false, nextIndex };

  if (key === "Escape") {
    return { action: "close", handled: true, nextIndex };
  }
  if (key === "Enter") {
    return {
      ...(itemCount > 0 && !repeat ? { action: "activate" as const } : {}),
      handled: true,
      nextIndex,
    };
  }
  if (key === "Home") {
    return { handled: true, nextIndex: 0 };
  }
  if (key === "End") {
    return { handled: true, nextIndex: Math.max(0, itemCount - 1) };
  }
  if (key === "ArrowDown") {
    return {
      handled: true,
      nextIndex: itemCount > 0 ? (nextIndex + 1) % itemCount : 0,
    };
  }
  if (key === "ArrowUp") {
    return {
      handled: true,
      nextIndex: itemCount > 0 ? (nextIndex - 1 + itemCount) % itemCount : 0,
    };
  }
  return { handled: false, nextIndex };
}
