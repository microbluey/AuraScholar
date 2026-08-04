import type { WorkWithAuthors } from "@aurascholar/db";

export type LibraryFilter = "all" | "reading" | "unread" | "noted" | "starred" | "trash";
export type LibraryExtraFilter = "with-pdf" | "without-pdf";
export type LibrarySortMode = "added" | "year";

export interface LibraryWorkspaceWorkMeta {
  annotations: number;
  pdfs: number;
  tags: string[];
}

const LIBRARY_FILTERS = new Set<LibraryFilter>([
  "all",
  "reading",
  "unread",
  "noted",
  "starred",
  "trash",
]);

export interface LibraryDeepLinkView {
  activeCollection: string | null;
  activeFilter: LibraryFilter;
  activeSource: string | null;
  activeTag: string | null;
  extraFilter: LibraryExtraFilter | null;
  search: string;
  selectedWorkId: string | null;
}

export type LibraryBrowseView = Omit<LibraryDeepLinkView, "selectedWorkId">;

export interface LibraryDeepLinkIntent {
  filter: LibraryFilter;
  workId: string;
}

export interface LibraryRouteRequest extends LibraryDeepLinkIntent {
  /**
   * Identifies this concrete history entry and its requested Library view.
   * A work/filter pair repeated in a new location must acquire new ownership.
   */
  key: string;
}

export interface LibraryRouteRequestInput {
  filter: string | null;
  locationKey: string;
  workId: string | null;
}

export function normalizeLibraryFilter(value: string | null): LibraryFilter | null {
  return value && LIBRARY_FILTERS.has(value as LibraryFilter) ? (value as LibraryFilter) : null;
}

export function createLibraryRouteRequest(
  input: LibraryRouteRequestInput,
): LibraryRouteRequest | null {
  if (!input.workId) return null;
  const filter = normalizeLibraryFilter(input.filter) ?? "all";
  return {
    filter,
    key: `${input.locationKey}\u0000${input.workId}\u0000${filter}`,
    workId: input.workId,
  };
}

export function withoutLibraryRouteParams(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("work");
  next.delete("filter");
  return next;
}

/**
 * Returns whether an async Library read still owns the current route.
 * `null` owns `null` so ordinary, non-deep-link refreshes can commit; a route
 * request loses ownership as soon as a newer request replaces or cancels it.
 */
export function ownsLibraryRouteRequest(
  ownerKey: string | null,
  currentRequest: LibraryRouteRequest | null,
): boolean {
  return ownerKey === (currentRequest?.key ?? null);
}

export function resolveActiveLibraryRouteRequest(
  request: LibraryRouteRequest | null,
  cancelledRouteKey: string | null,
): LibraryRouteRequest | null {
  return request?.key === cancelledRouteKey ? null : request;
}

export type LibraryRouteRefreshDisposition =
  | "load-browse"
  | "load-route"
  | "skip-applied-route"
  | "skip-route-consumption";

export function libraryRouteRefreshDisposition(
  currentRouteKey: string | null,
  appliedRouteKey: string | null,
): LibraryRouteRefreshDisposition {
  if (currentRouteKey) {
    return currentRouteKey === appliedRouteKey ? "skip-applied-route" : "load-route";
  }
  return appliedRouteKey ? "skip-route-consumption" : "load-browse";
}

export function libraryDeepLinkView(intent: LibraryDeepLinkIntent): LibraryDeepLinkView {
  return {
    activeCollection: null,
    activeFilter: intent.filter,
    activeSource: null,
    activeTag: null,
    extraFilter: null,
    search: "",
    selectedWorkId: intent.workId,
  };
}

export function hasLibraryBrowseViewChanged(
  current: LibraryBrowseView,
  next: LibraryBrowseView,
): boolean {
  return (
    current.activeCollection !== next.activeCollection ||
    current.activeFilter !== next.activeFilter ||
    current.activeSource !== next.activeSource ||
    current.activeTag !== next.activeTag ||
    current.extraFilter !== next.extraFilter ||
    current.search !== next.search
  );
}

export function filterLibraryWorkspaceItems(input: {
  activeFilter: LibraryFilter;
  activeSource: string | null;
  activeTag: string | null;
  extraFilter: LibraryExtraFilter | null;
  items: readonly WorkWithAuthors[];
  sortMode: LibrarySortMode;
  workMeta: Readonly<Record<string, LibraryWorkspaceWorkMeta | undefined>>;
}): WorkWithAuthors[] {
  const filtered = input.items.filter((work) => {
    if (input.activeFilter === "trash") return true;
    const meta = input.workMeta[work.id];
    if (input.activeTag && !(meta?.tags ?? []).includes(input.activeTag)) return false;
    if (
      input.activeSource &&
      !`${work.venue_name ?? ""} ${work.type ?? ""} ${work.arxiv_id ? "arXiv" : ""}`
        .toLowerCase()
        .includes(input.activeSource.toLowerCase())
    ) {
      return false;
    }
    if (input.extraFilter === "with-pdf" && (meta?.pdfs ?? 0) === 0) return false;
    if (input.extraFilter === "without-pdf" && (meta?.pdfs ?? 0) > 0) return false;
    if (input.activeFilter === "reading") return work.reading_status === "reading";
    if (input.activeFilter === "unread") return work.reading_status === "unread";
    if (input.activeFilter === "noted") return (meta?.annotations ?? 0) > 0;
    if (input.activeFilter === "starred") return work.starred === 1;
    return true;
  });
  return filtered.sort((left, right) => {
    if (input.sortMode === "year") return (right.year ?? 0) - (left.year ?? 0);
    return (right.created_at ?? 0) - (left.created_at ?? 0);
  });
}

export function resolveLibraryVisiblePage(input: {
  page: number;
  pageCount: number;
  pageSize: number;
  selectedWorkId: string | null;
  workIds: readonly string[];
}): number {
  const lastPage = Math.max(0, input.pageCount - 1);
  const boundedPage = Math.min(Math.max(0, input.page), lastPage);
  if (!input.selectedWorkId) return boundedPage;
  const selectedIndex = input.workIds.indexOf(input.selectedWorkId);
  if (selectedIndex < 0) return boundedPage;
  return Math.min(Math.floor(selectedIndex / input.pageSize), lastPage);
}
