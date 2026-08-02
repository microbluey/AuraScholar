import type { EvidenceKind } from "@aurascholar/db/repos/evidence";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";

export type EvidenceInboxScope =
  | { kind: "inbox" }
  | { kind: "library" }
  | { kind: "project"; projectId: string };

export type EvidenceSourceFilter = "all" | "available" | "historical" | "unavailable" | "removed";

export interface EvidenceInboxFilters {
  evidenceKind: EvidenceKind | "all";
  query: string;
  scope: EvidenceInboxScope;
  source: EvidenceSourceFilter;
}

export interface EvidenceSearchFilters {
  availabilityStatuses?: Array<"unchecked" | "available" | "missing" | "relink-required">;
  canonicalStatuses?: Array<"active" | "work-removed" | "asset-removed" | "revision-removed">;
  evidenceKinds?: EvidenceKind[];
  query?: string;
  revisionStatuses?: Array<"current" | "historical">;
  scope: EvidenceInboxScope;
}

export const DEFAULT_EVIDENCE_FILTERS: EvidenceInboxFilters = {
  evidenceKind: "all",
  query: "",
  scope: { kind: "inbox" },
  source: "all",
};

export const EVIDENCE_KIND_OPTIONS: ReadonlyArray<{ label: string; value: EvidenceKind }> = [
  { label: "方法", value: "method" },
  { label: "数据", value: "data" },
  { label: "局限", value: "limitation" },
  { label: "定义", value: "definition" },
  { label: "背景", value: "context" },
];

export function evidenceKindLabel(kind: EvidenceKind): string {
  return EVIDENCE_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

export function toEvidenceSearchFilters(filters: EvidenceInboxFilters): EvidenceSearchFilters {
  const common: EvidenceSearchFilters = {
    ...(filters.evidenceKind === "all" ? {} : { evidenceKinds: [filters.evidenceKind] }),
    ...(filters.query.trim() ? { query: filters.query.trim() } : {}),
    scope: filters.scope,
  };
  switch (filters.source) {
    case "available":
      return {
        ...common,
        availabilityStatuses: ["available", "unchecked"],
        canonicalStatuses: ["active"],
      };
    case "historical":
      return { ...common, revisionStatuses: ["historical"] };
    case "unavailable":
      return { ...common, availabilityStatuses: ["missing", "relink-required"] };
    case "removed":
      return {
        ...common,
        canonicalStatuses: ["work-removed", "asset-removed", "revision-removed"],
      };
    default:
      return common;
  }
}

export function evidenceReaderPath(item: EvidenceInboxItemDto): string | null {
  if (
    item.evidence.canonicalStatus !== "active" ||
    (item.evidence.availabilityStatus !== "available" &&
      item.evidence.availabilityStatus !== "unchecked") ||
    !item.attachmentId
  ) {
    return null;
  }
  const params = new URLSearchParams({
    attachment: item.attachmentId,
    evidence: item.evidence.id,
    page: String((item.pageIndex ?? 0) + 1),
    work: item.evidence.workId,
  });
  return `/reader?${params.toString()}`;
}

export function sourceStatusLabel(item: EvidenceInboxItemDto): string {
  if (item.evidence.canonicalStatus !== "active") return "来源已移除";
  if (item.evidence.availabilityStatus === "missing") return "本地文件缺失";
  if (item.evidence.availabilityStatus === "relink-required") return "需要重新关联";
  if (item.evidence.revisionStatus === "historical") return "历史修订";
  if (item.evidence.availabilityStatus === "available") return "来源可用";
  return "来源待校验";
}

export function canRecoverEvidenceSource(item: EvidenceInboxItemDto): boolean {
  return (
    item.evidence.canonicalStatus === "active" &&
    item.mimeType === "application/pdf" &&
    (item.evidence.availabilityStatus === "missing" ||
      item.evidence.availabilityStatus === "relink-required")
  );
}

export function hasEvidenceFilters(filters: EvidenceInboxFilters): boolean {
  return (
    Boolean(filters.query.trim()) || filters.evidenceKind !== "all" || filters.source !== "all"
  );
}

export function evidenceSourceDescription(item: EvidenceInboxItemDto): string {
  const authors = item.authorNames.slice(0, 3).join("、");
  const authorSuffix = item.authorNames.length > 3 ? " 等" : "";
  return [
    authors ? `${authors}${authorSuffix}` : null,
    item.year,
    `第 ${(item.pageIndex ?? 0) + 1} 页`,
  ]
    .filter((value): value is string | number => value !== null && value !== "")
    .join(" · ");
}
