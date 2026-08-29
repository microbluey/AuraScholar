import type { CollectionRow, WorkWithAuthors } from "@aurascholar/db";
import type {
  LibraryPageBrowseSummary,
  LibraryPageData,
  WorkTableMeta,
} from "../../services/library-page-data";
import {
  filterLibraryWorkspaceItems,
  type LibraryExtraFilter,
  type LibraryFilter,
  type LibrarySortMode,
} from "./library-workspace-state";

export interface PreviewLibraryPageInput {
  activeCollection: string | null;
  activeFilter: LibraryFilter;
  activeSource: string | null;
  activeTag: string | null;
  collections: CollectionRow[];
  extraFilter: LibraryExtraFilter | null;
  focusWorkId?: string | null;
  page: number;
  pageSize: number;
  previewItems: WorkWithAuthors[];
  previewTrashItems: WorkWithAuthors[];
  previewWorkCollections: Readonly<Record<string, string>>;
  search: string;
  sortMode: LibrarySortMode;
  workMeta: Record<string, WorkTableMeta>;
}

function matchesPreviewSearch(
  work: WorkWithAuthors,
  meta: WorkTableMeta | undefined,
  query: string,
): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return [
    work.title,
    work.abstract,
    work.doi,
    work.arxiv_id,
    work.venue_name,
    work.year?.toString(),
    ...work.authorNames,
    ...(meta?.tags ?? []),
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(text));
}

function browseSummary(
  works: readonly WorkWithAuthors[],
  workMeta: Record<string, WorkTableMeta>,
): LibraryPageBrowseSummary {
  const availableTags = Array.from(
    new Set(works.flatMap((work) => workMeta[work.id]?.tags ?? [])),
  ).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const availableSources = Array.from(
    new Set(
      works
        .flatMap((work) => [work.venue_name, work.type, work.arxiv_id ? "arXiv" : null])
        .filter((value): value is string => Boolean(value?.trim())),
    ),
  ).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const readingTotal = works.filter((work) => work.reading_status === "reading").length;
  const unreadTotal = works.filter((work) => work.reading_status === "unread").length;
  const notedTotal = works.filter((work) => (workMeta[work.id]?.annotations ?? 0) > 0).length;
  const starredTotal = works.filter((work) => work.starred === 1).length;
  const withPdfTotal = works.filter((work) => (workMeta[work.id]?.pdfs ?? 0) > 0).length;
  return {
    availableSources,
    availableSourcesTruncated: false,
    availableTags,
    availableTagsTruncated: false,
    baseTotal: works.length,
    notedTotal,
    readingTotal,
    starredTotal,
    unreadTotal,
    withPdfTotal,
    withoutPdfTotal: works.length - withPdfTotal,
  };
}

/** Builds a browser-preview page with the same membership and count semantics as Desktop. */
export function loadPreviewLibraryPage(input: PreviewLibraryPageInput): LibraryPageData {
  const isTrash = input.activeFilter === "trash";
  const source = isTrash ? input.previewTrashItems : input.previewItems;
  const collectionScoped =
    !isTrash && input.activeCollection
      ? source.filter((work) => input.previewWorkCollections[work.id] === input.activeCollection)
      : source;
  const baseWorks = collectionScoped.filter((work) =>
    matchesPreviewSearch(work, input.workMeta[work.id], input.search),
  );
  const visibleWorks = isTrash
    ? baseWorks
    : filterLibraryWorkspaceItems({
        activeFilter: input.activeFilter,
        activeSource: input.activeSource,
        activeTag: input.activeTag,
        extraFilter: input.extraFilter,
        items: baseWorks,
        sortMode: input.sortMode,
        workMeta: input.workMeta,
      });
  const focusIndex = input.focusWorkId
    ? visibleWorks.findIndex((work) => work.id === input.focusWorkId)
    : -1;
  const requestedOffset =
    focusIndex >= 0
      ? Math.floor(focusIndex / input.pageSize) * input.pageSize
      : input.page * input.pageSize;
  const lastOffset = Math.max(
    0,
    Math.floor(Math.max(0, visibleWorks.length - 1) / input.pageSize) * input.pageSize,
  );
  const offset = Math.min(Math.max(0, requestedOffset), lastOffset);
  const scopedSummary = isTrash
    ? {
        availableSources: [],
        availableSourcesTruncated: false,
        availableTags: [],
        availableTagsTruncated: false,
        baseTotal: 0,
        notedTotal: 0,
        readingTotal: 0,
        starredTotal: 0,
        unreadTotal: 0,
        withPdfTotal: 0,
        withoutPdfTotal: 0,
      }
    : browseSummary(baseWorks, input.workMeta);
  return {
    browseSummary: scopedSummary,
    collections: input.collections,
    limit: input.pageSize,
    offset,
    trashCount: input.previewTrashItems.length,
    total: visibleWorks.length,
    works: visibleWorks.slice(offset, offset + input.pageSize),
    workMeta: input.workMeta,
  };
}
