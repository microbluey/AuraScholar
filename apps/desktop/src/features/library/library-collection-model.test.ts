import type { CollectionRow } from "@aurascholar/db";
import { describe, expect, it } from "vitest";
import { LIBRARY_COLLECTION_EVENTS, moveCollectionRows } from "./library-collection-model";

function collection(
  id: string,
  parentId: string | null,
  sortOrder: number,
  name = id,
): CollectionRow {
  return {
    id,
    library_id: "library-a",
    name,
    parent_id: parentId,
    sort_order: sortOrder,
    count: 0,
  };
}

function placement(rows: CollectionRow[]) {
  return Object.fromEntries(
    rows.map((row) => [row.id, { parentId: row.parent_id, sortOrder: row.sort_order }]),
  );
}

describe("library collection model", () => {
  it("publishes the stable window event names used by collection management", () => {
    expect(LIBRARY_COLLECTION_EVENTS).toEqual({
      create: "aurascholar:create-collection",
      delete: "aurascholar:delete-collection",
      manage: "aurascholar:manage-collections",
      move: "aurascholar:move-collection",
      rename: "aurascholar:rename-collection",
    });
  });

  it("reorders siblings without changing the collection array order", () => {
    const rows = [
      collection("first", null, 0),
      collection("second", null, 1),
      collection("third", null, 2),
    ];

    const result = moveCollectionRows(rows, {
      id: "third",
      parentId: null,
      position: 0,
    });

    expect(result.map((row) => row.id)).toEqual(["first", "second", "third"]);
    expect(placement(result)).toEqual({
      first: { parentId: null, sortOrder: 1 },
      second: { parentId: null, sortOrder: 2 },
      third: { parentId: null, sortOrder: 0 },
    });
  });

  it("moves across levels and compacts both sibling groups", () => {
    const rows = [
      collection("root-a", null, 0),
      collection("moving", null, 1),
      collection("root-c", null, 2),
      collection("parent", null, 3),
      collection("child-a", "parent", 0),
      collection("child-b", "parent", 1),
    ];

    const result = moveCollectionRows(rows, {
      id: "moving",
      parentId: "parent",
      position: 1,
    });

    expect(placement(result)).toEqual({
      "root-a": { parentId: null, sortOrder: 0 },
      moving: { parentId: "parent", sortOrder: 1 },
      "root-c": { parentId: null, sortOrder: 1 },
      parent: { parentId: null, sortOrder: 2 },
      "child-a": { parentId: "parent", sortOrder: 0 },
      "child-b": { parentId: "parent", sortOrder: 2 },
    });
  });

  it("truncates and clamps target positions to the sibling bounds", () => {
    const rows = [
      collection("parent", null, 0),
      collection("first", "parent", 0),
      collection("second", "parent", 1),
      collection("moving-low", null, 1),
      collection("moving-high", null, 2),
    ];

    const beforeFirst = moveCollectionRows(rows, {
      id: "moving-low",
      parentId: "parent",
      position: -3.8,
    });
    expect(placement(beforeFirst)["moving-low"]).toEqual({
      parentId: "parent",
      sortOrder: 0,
    });

    const afterLast = moveCollectionRows(rows, {
      id: "moving-high",
      parentId: "parent",
      position: 99.9,
    });
    expect(placement(afterLast)["moving-high"]).toEqual({
      parentId: "parent",
      sortOrder: 2,
    });
  });

  it("does not mutate the input rows or their collection records", () => {
    const rows = [
      collection("first", null, 0),
      collection("second", null, 1),
      collection("child", "first", 0),
    ];
    const snapshot = structuredClone(rows);

    const result = moveCollectionRows(rows, {
      id: "second",
      parentId: "first",
      position: 0,
    });

    expect(rows).toEqual(snapshot);
    expect(result).not.toBe(rows);
    expect(result.find((row) => row.id === "second")).not.toBe(
      rows.find((row) => row.id === "second"),
    );
  });

  it("returns the original array when the moving id is unknown", () => {
    const rows = [collection("known", null, 0)];

    expect(
      moveCollectionRows(rows, {
        id: "missing",
        parentId: null,
        position: 0,
      }),
    ).toBe(rows);
  });
});
