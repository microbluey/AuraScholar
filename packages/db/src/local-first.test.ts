import { beforeEach, describe, expect, it } from "vitest";
import { createNodeDatabase, type Database } from "./database";
import { ensureLocalFirstState } from "./local-first";
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
});
