import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { ensureLocalFirstState, LOCAL_LIBRARY_ID_KEY, requireLocalLibraryId } from "./local-first";
import { runMigrations } from "./migrations";

let db: Database;

beforeEach(async () => {
  db = await createNodeDatabase(":memory:");
  await runMigrations(db);
});

describe("ensureLocalFirstState", () => {
  it("creates stable local library and device identity", async () => {
    const first = await ensureLocalFirstState(db, {
      deviceId: "dev-a",
      deviceName: "Work Mac",
      platform: "darwin",
    });
    const second = await ensureLocalFirstState(db, {
      deviceId: "dev-other",
      deviceName: "Work Mac",
      platform: "darwin",
    });

    expect(second).toEqual(first);

    const libraries = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM libraries`,
    );
    expect(libraries).toEqual([{ id: first.libraryId, name: "Personal Library" }]);

    const devices = await db.query<{ device_id: string; platform: string }>(
      `SELECT device_id, platform FROM devices`,
    );
    expect(devices).toEqual([{ device_id: "dev-a", platform: "darwin" }]);
  });

  it("reads the active Library identity without mutating it", async () => {
    const libraryId = await requireLocalLibraryId(db);
    await db.run(`UPDATE libraries SET updated_at = 123 WHERE id = ?`, [libraryId]);

    expect(await requireLocalLibraryId(db)).toBe(libraryId);
    expect(
      Number(await db.queryScalar(`SELECT updated_at FROM libraries WHERE id = '${libraryId}'`)),
    ).toBe(123);
  });

  it("fails closed for malformed or inactive Library identity", async () => {
    const libraryId = await requireLocalLibraryId(db);
    await db.run(`UPDATE settings SET value_json = ? WHERE key = ?`, [
      "{not-json",
      LOCAL_LIBRARY_ID_KEY,
    ]);
    await expect(requireLocalLibraryId(db)).rejects.toThrow(/missing or malformed/);

    await db.run(`UPDATE settings SET value_json = ? WHERE key = ?`, [
      JSON.stringify(libraryId),
      LOCAL_LIBRARY_ID_KEY,
    ]);
    await db.run(`UPDATE libraries SET deleted_at = 1 WHERE id = ?`, [libraryId]);
    await expect(requireLocalLibraryId(db)).rejects.toThrow(/not active/);
  });
});
