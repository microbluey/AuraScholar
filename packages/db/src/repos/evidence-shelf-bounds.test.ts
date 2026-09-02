import { describe, expect, it } from "vitest";
import type { Database } from "../database";
import {
  assertEvidenceShelfListBudget,
  MAX_EVIDENCE_SHELF_LIST_BYTES,
  MAX_EVIDENCE_SHELF_LIST_ROWS,
  readEvidenceShelfListBudget,
} from "./evidence-shelf-bounds";

describe("Evidence Shelf list bounds", () => {
  it("uses an overflow-safe SQLite total and normalizes driver scalar values", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] | undefined;
    const database: Database = {
      async query(sql, params = []) {
        capturedSql = sql;
        capturedParams = params;
        return [{ row_count: "7", payload_bytes: "1234.5" }];
      },
      async run() {
        return 0;
      },
      async exec() {},
      async queryScalar() {
        return undefined;
      },
    };

    await expect(readEvidenceShelfListBudget(database, "library", "project")).resolves.toEqual({
      rowCount: 7,
      payloadBytes: 1234.5,
    });
    expect(capturedSql).toContain("COUNT(*) AS row_count");
    expect(capturedSql).toContain("TOTAL(");
    expect(capturedSql).toContain("length(CAST(anchor_snapshot_json AS BLOB))");
    expect(capturedSql).toContain("length(CAST(preview_payload_json AS BLOB))");
    expect(capturedSql).toContain("deleted_at IS NULL");
    expect(capturedParams).toEqual([2048, "library", "project"]);
  });

  it("fails closed when SQLite reports an accumulator overflow", async () => {
    const database: Database = {
      async query() {
        return [{ row_count: 1, payload_bytes: null }];
      },
      async run() {
        return 0;
      },
      async exec() {},
      async queryScalar() {
        return undefined;
      },
    };

    const budget = await readEvidenceShelfListBudget(database, "library", "project");
    expect(budget.payloadBytes).toBe(Number.POSITIVE_INFINITY);
    expect(() => assertEvidenceShelfListBudget(budget)).toThrow(
      `Evidence shelf output is limited to ${MAX_EVIDENCE_SHELF_LIST_BYTES} bytes`,
    );
  });

  it("keeps the public row limit aligned with the command contract", () => {
    expect(MAX_EVIDENCE_SHELF_LIST_ROWS).toBe(1_000);
  });
});
