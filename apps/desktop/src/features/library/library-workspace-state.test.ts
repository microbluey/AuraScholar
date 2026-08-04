import { describe, expect, it } from "vitest";
import type { WorkWithAuthors } from "@aurascholar/db";
import {
  createLibraryRouteRequest,
  filterLibraryWorkspaceItems,
  hasLibraryBrowseViewChanged,
  libraryDeepLinkView,
  libraryRouteRefreshDisposition,
  normalizeLibraryFilter,
  ownsLibraryRouteRequest,
  resolveActiveLibraryRouteRequest,
  resolveLibraryVisiblePage,
  withoutLibraryRouteParams,
} from "./library-workspace-state";

function work(
  id: string,
  input: Partial<WorkWithAuthors> & Pick<WorkWithAuthors, "reading_status" | "starred">,
): WorkWithAuthors {
  return {
    arxiv_id: null,
    authors: [],
    created_at: 0,
    id,
    title: id,
    type: "article-journal",
    venue_name: null,
    year: null,
    ...input,
  } as WorkWithAuthors;
}

describe("Library workspace route state", () => {
  it("accepts only the supported route filters", () => {
    expect(normalizeLibraryFilter("all")).toBe("all");
    expect(normalizeLibraryFilter("reading")).toBe("reading");
    expect(normalizeLibraryFilter("unread")).toBe("unread");
    expect(normalizeLibraryFilter("noted")).toBe("noted");
    expect(normalizeLibraryFilter("starred")).toBe("starred");
    expect(normalizeLibraryFilter("trash")).toBe("trash");
    expect(normalizeLibraryFilter("archived")).toBeNull();
    expect(normalizeLibraryFilter("")).toBeNull();
    expect(normalizeLibraryFilter(null)).toBeNull();
  });

  it("creates a route request from the location and defaults an invalid filter", () => {
    expect(
      createLibraryRouteRequest({
        filter: "not-a-library-filter",
        locationKey: "location-b",
        workId: "work-b",
      }),
    ).toEqual({
      filter: "all",
      key: "location-b\u0000work-b\u0000all",
      workId: "work-b",
    });
    expect(
      createLibraryRouteRequest({ filter: "trash", locationKey: "location-b", workId: null }),
    ).toBeNull();
  });

  it("consumes only Library route parameters", () => {
    const next = withoutLibraryRouteParams(
      new URLSearchParams("work=work-b&filter=trash&panel=notes"),
    );
    expect(next.toString()).toBe("panel=notes");
  });

  it("clears the prior browse view for a deep-link target", () => {
    expect(libraryDeepLinkView({ filter: "trash", workId: "work-b" })).toEqual({
      activeCollection: null,
      activeFilter: "trash",
      activeSource: null,
      activeTag: null,
      extraFilter: null,
      search: "",
      selectedWorkId: "work-b",
    });
  });

  it("only reserves a page-reset skip when the deep link changes the browse view", () => {
    const defaultView = libraryDeepLinkView({ filter: "all", workId: "work-b" });
    expect(
      hasLibraryBrowseViewChanged(
        {
          activeCollection: null,
          activeFilter: "all",
          activeSource: null,
          activeTag: null,
          extraFilter: null,
          search: "",
        },
        defaultView,
      ),
    ).toBe(false);
    expect(
      hasLibraryBrowseViewChanged(
        {
          activeCollection: "collection-a",
          activeFilter: "reading",
          activeSource: "journal",
          activeTag: "method",
          extraFilter: "with-pdf",
          search: "graph",
        },
        defaultView,
      ),
    ).toBe(true);
  });

  it("changes route ownership for a newer B to C request and for cancellation", () => {
    const requestB = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-b",
      workId: "work-b",
    });
    const requestC = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-c",
      workId: "work-c",
    });
    if (!requestB || !requestC) throw new Error("Expected route requests");

    expect(ownsLibraryRouteRequest(requestB.key, requestB)).toBe(true);
    expect(ownsLibraryRouteRequest(requestB.key, requestC)).toBe(false);
    expect(ownsLibraryRouteRequest(requestB.key, null)).toBe(false);
    expect(ownsLibraryRouteRequest(null, null)).toBe(true);
  });

  it("treats a new history location or filter as a new owner for the same work", () => {
    const original = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-b",
      workId: "work-b",
    });
    const newLocation = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-c",
      workId: "work-b",
    });
    const trashLocation = createLibraryRouteRequest({
      filter: "trash",
      locationKey: "location-b",
      workId: "work-b",
    });
    if (!original || !newLocation || !trashLocation) throw new Error("Expected route requests");

    expect(ownsLibraryRouteRequest(original.key, newLocation)).toBe(false);
    expect(ownsLibraryRouteRequest(original.key, trashLocation)).toBe(false);
  });

  it("cancels a pending URL request immediately and admits a newer route", () => {
    const requestB = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-b",
      workId: "work-b",
    });
    const requestC = createLibraryRouteRequest({
      filter: "all",
      locationKey: "location-c",
      workId: "work-c",
    });
    if (!requestB || !requestC) throw new Error("Expected route requests");

    expect(resolveActiveLibraryRouteRequest(requestB, requestB.key)).toBeNull();
    expect(resolveActiveLibraryRouteRequest(requestC, requestB.key)).toBe(requestC);
  });

  it("does not reload an applied route while React Router consumes its URL", () => {
    expect(libraryRouteRefreshDisposition("route-b", null)).toBe("load-route");
    expect(libraryRouteRefreshDisposition("route-b", "route-b")).toBe("skip-applied-route");
    expect(libraryRouteRefreshDisposition("route-c", "route-b")).toBe("load-route");
    expect(libraryRouteRefreshDisposition(null, "route-b")).toBe("skip-route-consumption");
    expect(libraryRouteRefreshDisposition(null, null)).toBe("load-browse");
  });
});

describe("Library workspace pagination", () => {
  const workIds = Array.from({ length: 65 }, (_, index) => `work-${index + 1}`);

  it("keeps the 30th item on page one and moves the 31st item to page two", () => {
    expect(
      resolveLibraryVisiblePage({
        page: 0,
        pageCount: 3,
        pageSize: 30,
        selectedWorkId: "work-30",
        workIds,
      }),
    ).toBe(0);
    expect(
      resolveLibraryVisiblePage({
        page: 0,
        pageCount: 3,
        pageSize: 30,
        selectedWorkId: "work-31",
        workIds,
      }),
    ).toBe(1);
  });

  it("clamps an unowned page to the available range", () => {
    expect(
      resolveLibraryVisiblePage({
        page: -4,
        pageCount: 3,
        pageSize: 30,
        selectedWorkId: null,
        workIds,
      }),
    ).toBe(0);
    expect(
      resolveLibraryVisiblePage({
        page: 9,
        pageCount: 3,
        pageSize: 30,
        selectedWorkId: "missing-work",
        workIds,
      }),
    ).toBe(2);
    expect(
      resolveLibraryVisiblePage({
        page: 4,
        pageCount: 0,
        pageSize: 30,
        selectedWorkId: null,
        workIds: [],
      }),
    ).toBe(0);
  });
});

describe("Library workspace filtering", () => {
  const reading = work("reading", {
    created_at: 10,
    reading_status: "reading",
    starred: 1,
    venue_name: "Journal of Testing",
    year: 2022,
  });
  const unread = work("unread", {
    arxiv_id: "2401.00001",
    created_at: 20,
    reading_status: "unread",
    starred: 0,
    year: 2024,
  });
  const workMeta = {
    reading: { annotations: 2, pdfs: 1, tags: ["method"] },
    unread: { annotations: 0, pdfs: 0, tags: ["survey"] },
  };

  it("combines status, tag, source, and PDF facets", () => {
    expect(
      filterLibraryWorkspaceItems({
        activeFilter: "reading",
        activeSource: "journal",
        activeTag: "method",
        extraFilter: "with-pdf",
        items: [unread, reading],
        sortMode: "added",
        workMeta,
      }).map((item) => item.id),
    ).toEqual(["reading"]);
  });

  it("keeps trash rows visible regardless of ordinary facets and still sorts them", () => {
    expect(
      filterLibraryWorkspaceItems({
        activeFilter: "trash",
        activeSource: "missing-source",
        activeTag: "missing-tag",
        extraFilter: "with-pdf",
        items: [reading, unread],
        sortMode: "year",
        workMeta,
      }).map((item) => item.id),
    ).toEqual(["unread", "reading"]);
  });
});
