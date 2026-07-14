import { describe, expect, it } from "vitest";
import {
  columnsForSyncedTable,
  pickKnownTableRecord,
  pickKnownTableStringRecord,
} from "./table-guard";

const TABLES = {
  notes: ["text", "deleted_at"],
  works: ["title", "year", "deleted_at"],
} as const;

describe("table guards", () => {
  it("accepts only own table keys", () => {
    expect(columnsForSyncedTable(TABLES, "works")).toEqual(["title", "year", "deleted_at"]);
    expect(columnsForSyncedTable(TABLES, "missing")).toBeNull();
    expect(columnsForSyncedTable(TABLES, "__proto__")).toBeNull();
    expect(columnsForSyncedTable(TABLES, "constructor")).toBeNull();
  });

  it("keeps only known columns from a synced table", () => {
    expect(
      pickKnownTableRecord(TABLES, "works", {
        title: "Paper",
        year: 2026,
        venue: "Unexpected",
        ["__proto__"]: "ignored",
      }),
    ).toEqual({ title: "Paper", year: 2026 });
    expect(pickKnownTableRecord(TABLES, "__proto__", { title: "Paper" })).toBeNull();
    expect(pickKnownTableRecord(TABLES, "works", "not an object")).toEqual({});
  });

  it("keeps only string column clocks", () => {
    expect(
      pickKnownTableStringRecord(TABLES, "works", {
        title: "000000000001000-000000-dev-a",
        year: 123,
        venue: "ignored",
      }),
    ).toEqual({ title: "000000000001000-000000-dev-a" });
  });
});
