import { describe, expect, it } from "vitest";
import { SyncEngine } from "./engine";
import type { MarkPushedOptions } from "./engine";
import { HlcClock } from "./hlc";
import { MemorySyncProvider } from "./memory-provider";
import { MemorySyncStorage } from "./memory-storage";
import { encodeSegment } from "./types";

const encoder = new TextEncoder();

function makeDevice(deviceId: string, provider: MemorySyncProvider, wall?: () => number) {
  const clock = new HlcClock(deviceId, wall);
  const storage = new MemorySyncStorage(deviceId);
  const engine = new SyncEngine(provider, storage, deviceId, clock);
  return { clock, storage, engine };
}

class FailingApplyStorage extends MemorySyncStorage {
  failOnRowId: string | null = null;

  override async applyUpsert(
    table: string,
    rowId: string,
    values: Record<string, unknown>,
    columnHlcs: Record<string, string>,
  ): Promise<void> {
    if (rowId === this.failOnRowId) {
      throw new Error(`forced apply failure for ${rowId}`);
    }
    await super.applyUpsert(table, rowId, values, columnHlcs);
  }
}

class TrackingMarkPushedStorage extends MemorySyncStorage {
  readonly markCalls: Array<{ complete: boolean | undefined; uptoSeq: number }> = [];

  override async markPushed(
    uptoSeq: number,
    options: MarkPushedOptions = {},
  ): Promise<void> {
    this.markCalls.push({ complete: options.complete, uptoSeq });
    await super.markPushed(uptoSeq, options);
  }
}

class TableAwareStorage extends MemorySyncStorage {
  constructor(
    deviceId: string,
    private readonly supportedTables: readonly string[],
  ) {
    super(deviceId);
  }

  supportsTable(table: string): boolean {
    return this.supportedTables.includes(table);
  }
}

class SchemaAwareStorage extends MemorySyncStorage {
  constructor(
    deviceId: string,
    private readonly schema: Record<string, readonly string[]>,
  ) {
    super(deviceId);
  }

  supportsTable(table: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.schema, table);
  }

  supportsColumn(table: string, column: string): boolean {
    const columns = Object.prototype.hasOwnProperty.call(this.schema, table)
      ? this.schema[table]
      : undefined;
    return Boolean(columns?.includes(column));
  }
}

describe("SyncEngine", () => {
  it("round-trips changes between two devices", async () => {
    const remote = new MemorySyncProvider();
    const a = makeDevice("dev-a", remote);
    const b = makeDevice("dev-b", remote);

    a.storage.write("works", "w1", { title: "Paper A", year: 2024 }, a.clock.tick());
    await a.engine.sync();
    const result = await b.engine.sync();

    expect(result.pulledEntries).toBe(1);
    expect(result.appliedEntries).toBe(1);
    expect(b.storage.get("works", "w1")).toEqual({ title: "Paper A", year: 2024 });
  });

  it("rolls back a pulled segment when applying one entry fails", async () => {
    const remote = new MemorySyncProvider();
    const a = makeDevice("dev-a", remote);
    const bStorage = new FailingApplyStorage("dev-b");
    const b = {
      engine: new SyncEngine(remote, bStorage, "dev-b", new HlcClock("dev-b")),
      storage: bStorage,
    };

    a.storage.write("works", "w1", { title: "First remote row" }, a.clock.tick());
    a.storage.write("works", "w2", { title: "Second remote row" }, a.clock.tick());
    await a.engine.sync();

    b.storage.failOnRowId = "w2";
    await expect(b.engine.pull()).rejects.toThrow("forced apply failure for w2");

    expect(b.storage.get("works", "w1")).toBeNull();
    expect(b.storage.get("works", "w2")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);

    b.storage.failOnRowId = null;
    const result = await b.engine.pull();

    expect(result.pulledEntries).toBe(2);
    expect(result.appliedEntries).toBe(2);
    expect(b.storage.get("works", "w1")).toEqual({ title: "First remote row" });
    expect(b.storage.get("works", "w2")).toEqual({ title: "Second remote row" });
    expect(await b.storage.getCursor("dev-a")).toBe(2);
  });

  it("marks only the final pushed segment as a complete local snapshot", async () => {
    const remote = new MemorySyncProvider();
    const storage = new TrackingMarkPushedStorage("dev-a");
    const clock = new HlcClock("dev-a");
    const engine = new SyncEngine(remote, storage, "dev-a", clock);

    for (let i = 0; i < 501; i++) {
      storage.write("works", `w${i}`, { title: `Paper ${i}` }, clock.tick());
    }

    await engine.push();

    expect(storage.markCalls).toEqual([
      { uptoSeq: 500, complete: false },
      { uptoSeq: 501, complete: true },
    ]);
  });

  it("rejects malformed local push entries before uploading or marking them pushed", async () => {
    const remote = new MemorySyncProvider();
    const a = makeDevice("dev-a", remote);

    a.storage.write("works", "w1", { title: "First" }, a.clock.tick());
    a.storage.write("works", "w3", { title: "Gapped" }, a.clock.tick());
    a.storage.log[1]!.seq = 3;

    await expect(a.engine.push()).rejects.toThrow(
      "Invalid sync segment local changes for dev-a: non-contiguous entry sequence",
    );

    expect(await remote.list("journal/dev-a/")).toHaveLength(0);
    expect(await a.storage.lastPushedSeq()).toBe(0);
  });

  it("rejects malformed remote segments before applying rows or advancing cursors", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);
    const clock = new HlcClock("dev-a");
    const firstHlc = clock.tick();
    const secondHlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000001-000000000002.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 2,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "Should not partially apply" },
            columnHlcs: { title: firstHlc },
            hlc: firstHlc,
            deviceId: "dev-a",
          },
          {
            seq: 2,
            table: "works",
            rowId: "w2",
            op: "upsert",
            values: { title: "Wrong device" },
            columnHlcs: { title: secondHlc },
            hlc: secondHlc,
            deviceId: "dev-x",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow("belongs to dev-x");

    expect(b.storage.get("works", "w1")).toBeNull();
    expect(b.storage.get("works", "w2")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("rejects malformed column HLCs before applying rows or advancing cursors", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);
    const clock = new HlcClock("dev-a");
    const hlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000001-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 1,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "Bad clock" },
            columnHlcs: { title: "not-a-hlc" },
            hlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow("malformed column HLC");

    expect(b.storage.get("works", "w1")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("rejects remote sequence gaps before applying rows or advancing cursors", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);
    const clock = new HlcClock("dev-a");
    const hlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000002-000000000002.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 2,
        endSeq: 2,
        entries: [
          {
            seq: 2,
            table: "works",
            rowId: "w2",
            op: "upsert",
            values: { title: "Should wait for missing seq 1" },
            columnHlcs: { title: hlc },
            hlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow(
      "Invalid sync segment gap before journal/dev-a/000000000002-000000000002.jsonl",
    );

    expect(b.storage.get("works", "w2")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("rejects zero-based remote sequence ranges before applying rows or advancing cursors", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);
    const clock = new HlcClock("dev-a");
    const zeroHlc = clock.tick();
    const firstHlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000000-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 0,
        endSeq: 1,
        entries: [
          {
            seq: 0,
            table: "works",
            rowId: "w0",
            op: "upsert",
            values: { title: "Invalid zero sequence" },
            columnHlcs: { title: zeroHlc },
            hlc: zeroHlc,
            deviceId: "dev-a",
          },
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "Valid tail must not apply" },
            columnHlcs: { title: firstHlc },
            hlc: firstHlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow("bad sequence range");

    expect(b.storage.get("works", "w0")).toBeNull();
    expect(b.storage.get("works", "w1")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("rejects in-segment sequence gaps before applying rows or advancing cursors", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);
    const clock = new HlcClock("dev-a");
    const firstHlc = clock.tick();
    const thirdHlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000001-000000000003.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 3,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "Should not partially apply" },
            columnHlcs: { title: firstHlc },
            hlc: firstHlc,
            deviceId: "dev-a",
          },
          {
            seq: 3,
            table: "works",
            rowId: "w3",
            op: "upsert",
            values: { title: "Missing seq 2" },
            columnHlcs: { title: thirdHlc },
            hlc: thirdHlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow("non-contiguous entry sequence");

    expect(b.storage.get("works", "w1")).toBeNull();
    expect(b.storage.get("works", "w3")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("fails unsupported remote tables instead of silently skipping future data", async () => {
    const remote = new MemorySyncProvider();
    const storage = new TableAwareStorage("dev-b", ["works"]);
    const b = {
      engine: new SyncEngine(remote, storage, "dev-b", new HlcClock("dev-b")),
      storage,
    };
    const clock = new HlcClock("dev-a");
    const hlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000001-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 1,
        entries: [
          {
            seq: 1,
            table: "future_table",
            rowId: "f1",
            op: "upsert",
            values: { title: "From a newer client" },
            columnHlcs: { title: hlc },
            hlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow('Unsupported sync table "future_table"');

    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("fails unsupported remote columns before advancing the cursor", async () => {
    const remote = new MemorySyncProvider();
    const storage = new SchemaAwareStorage("dev-b", { works: ["title", "updated_at"] });
    const b = {
      engine: new SyncEngine(remote, storage, "dev-b", new HlcClock("dev-b")),
      storage,
    };
    const clock = new HlcClock("dev-a");
    const hlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000001-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 1,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: {
              title: "Known column",
              future_column: "From a newer client",
            },
            columnHlcs: {
              title: hlc,
              future_column: hlc,
            },
            hlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    await expect(b.engine.pull()).rejects.toThrow('Unsupported sync column "works.future_column"');

    expect(b.storage.get("works", "w1")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("wraps unreadable remote JSONL as a recoverable invalid segment", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);

    await remote.put(
      "journal/dev-a/000000000001-000000000001.jsonl",
      encoder.encode('{"seq":1,"table":"works"'),
    );

    await expect(b.engine.pull()).rejects.toThrow(
      "Invalid sync segment journal/dev-a/000000000001-000000000001.jsonl: unreadable JSON",
    );

    expect(await b.storage.getCursor("dev-a")).toBe(0);
  });

  it("does not downgrade the cursor when a stale overlapping segment follows a larger segment", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote);
    const clock = new HlcClock("dev-a");
    const firstHlc = clock.tick();
    const secondHlc = clock.tick();
    const thirdHlc = clock.tick();

    await remote.put(
      "journal/dev-a/000000000001-000000000003.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 3,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "First" },
            columnHlcs: { title: firstHlc },
            hlc: firstHlc,
            deviceId: "dev-a",
          },
          {
            seq: 2,
            table: "works",
            rowId: "w2",
            op: "upsert",
            values: { title: "Second" },
            columnHlcs: { title: secondHlc },
            hlc: secondHlc,
            deviceId: "dev-a",
          },
          {
            seq: 3,
            table: "works",
            rowId: "w3",
            op: "upsert",
            values: { title: "Third" },
            columnHlcs: { title: thirdHlc },
            hlc: thirdHlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );
    await remote.put(
      "journal/dev-a/000000000002-000000000002.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 2,
        endSeq: 2,
        entries: [
          {
            seq: 2,
            table: "works",
            rowId: "w2",
            op: "upsert",
            values: { title: "Second" },
            columnHlcs: { title: secondHlc },
            hlc: secondHlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    const result = await b.engine.pull();

    expect(result.pulledEntries).toBe(3);
    expect(b.storage.get("works", "w1")).toEqual({ title: "First" });
    expect(b.storage.get("works", "w2")).toEqual({ title: "Second" });
    expect(b.storage.get("works", "w3")).toEqual({ title: "Third" });
    expect(await b.storage.getCursor("dev-a")).toBe(3);
  });

  it("does not re-apply already-merged segments", async () => {
    const remote = new MemorySyncProvider();
    const a = makeDevice("dev-a", remote);
    const b = makeDevice("dev-b", remote);

    a.storage.write("works", "w1", { title: "T" }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();
    const second = await b.engine.sync();
    expect(second.pulledEntries).toBe(0);
  });

  it("merges different fields of the same row from both devices", async () => {
    const remote = new MemorySyncProvider();
    let wallA = 1000;
    let wallB = 1000;
    const a = makeDevice("dev-a", remote, () => wallA);
    const b = makeDevice("dev-b", remote, () => wallB);

    // Both start from a shared row.
    a.storage.write("works", "w1", { title: "Original", starred: 0 }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();

    // A edits title; B stars it. Different columns — both must survive.
    wallA = 2000;
    a.storage.write("works", "w1", { title: "Edited on A" }, a.clock.tick());
    wallB = 2500;
    b.storage.write("works", "w1", { starred: 1 }, b.clock.tick());

    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    expect(a.storage.get("works", "w1")).toEqual({ title: "Edited on A", starred: 1 });
    expect(b.storage.get("works", "w1")).toEqual({ title: "Edited on A", starred: 1 });
    expect(a.storage.conflicts).toHaveLength(0);
    expect(b.storage.conflicts).toHaveLength(0);
  });

  it("resolves same-field concurrent writes by HLC and records the loser", async () => {
    const remote = new MemorySyncProvider();
    let wallA = 1000;
    let wallB = 1000;
    const a = makeDevice("dev-a", remote, () => wallA);
    const b = makeDevice("dev-b", remote, () => wallB);

    a.storage.write("works", "w1", { title: "Base" }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();

    // Concurrent edits to the SAME column; B's wall clock is later → B wins.
    wallA = 2000;
    a.storage.write("works", "w1", { title: "A's edit" }, a.clock.tick());
    wallB = 3000;
    b.storage.write("works", "w1", { title: "B's edit" }, b.clock.tick());

    await b.engine.sync();
    await a.engine.sync(); // A pulls B's change → B wins, A's value recorded as conflict
    await b.engine.sync(); // B pulls A's change → A loses, recorded as conflict

    expect(a.storage.get("works", "w1")).toEqual({ title: "B's edit" });
    expect(b.storage.get("works", "w1")).toEqual({ title: "B's edit" });
    expect(a.storage.conflicts.length + b.storage.conflicts.length).toBeGreaterThan(0);
  });

  it("propagates deletes but lets newer local edits win over older deletes", async () => {
    const remote = new MemorySyncProvider();
    let wallA = 1000;
    let wallB = 1000;
    const a = makeDevice("dev-a", remote, () => wallA);
    const b = makeDevice("dev-b", remote, () => wallB);

    a.storage.write("notes", "n1", { text: "hello" }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();

    // A deletes at t=2000; B edits at t=3000 (later) — B's edit must survive on B.
    wallA = 2000;
    a.storage.deleteRow("notes", "n1", a.clock.tick());
    wallB = 3000;
    b.storage.write("notes", "n1", { text: "edited later" }, b.clock.tick());

    await a.engine.sync();
    await b.engine.sync(); // B sees A's older delete → ignores it

    expect(b.storage.get("notes", "n1")).toEqual({ text: "edited later" });
  });

  it("does not let an older remote upsert resurrect a newer local delete", async () => {
    const remote = new MemorySyncProvider();
    let wallA = 1000;
    let wallB = 1000;
    const a = makeDevice("dev-a", remote, () => wallA);
    const b = makeDevice("dev-b", remote, () => wallB);

    a.storage.write("works", "w1", { title: "Shared", deleted_at: null }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();

    wallA = 2000;
    a.storage.write("works", "w1", { title: "Older remote edit" }, a.clock.tick());
    await a.engine.push();

    wallB = 3000;
    b.storage.deleteRow("works", "w1", b.clock.tick());
    await b.engine.sync();

    expect(b.storage.get("works", "w1")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(2);

    await a.engine.sync();
    expect(a.storage.get("works", "w1")).toBeNull();
  });

  it("keeps a tombstone when a delete arrives before an older create from another device", async () => {
    const remote = new MemorySyncProvider();
    const c = makeDevice("dev-c", remote);
    const createHlc = new HlcClock("dev-a", () => 1000).tick();
    const deleteHlc = new HlcClock("dev-b", () => 3000).tick();

    await remote.put(
      "journal/dev-b/000000000001-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-b",
        startSeq: 1,
        endSeq: 1,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "delete",
            values: {},
            columnHlcs: {},
            hlc: deleteHlc,
            deviceId: "dev-b",
          },
        ],
      }),
    );
    await remote.put(
      "journal/dev-a/000000000001-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 1,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "Older create", deleted_at: null },
            columnHlcs: { title: createHlc, deleted_at: createHlc },
            hlc: createHlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    const result = await c.engine.pull();

    expect(result.pulledEntries).toBe(2);
    expect(result.appliedEntries).toBe(1);
    expect(c.storage.get("works", "w1")).toBeNull();
    expect(await c.storage.getCursor("dev-a")).toBe(1);
    expect(await c.storage.getCursor("dev-b")).toBe(1);
  });

  it("keeps a local unknown-row tombstone when an older remote create arrives later", async () => {
    const remote = new MemorySyncProvider();
    const b = makeDevice("dev-b", remote, () => 3000);
    const createHlc = new HlcClock("dev-a", () => 1000).tick();

    b.storage.deleteRow("works", "w1", b.clock.tick());
    await remote.put(
      "journal/dev-a/000000000001-000000000001.jsonl",
      encodeSegment({
        deviceId: "dev-a",
        startSeq: 1,
        endSeq: 1,
        entries: [
          {
            seq: 1,
            table: "works",
            rowId: "w1",
            op: "upsert",
            values: { title: "Older create", deleted_at: null },
            columnHlcs: { title: createHlc, deleted_at: createHlc },
            hlc: createHlc,
            deviceId: "dev-a",
          },
        ],
      }),
    );

    const result = await b.engine.pull();

    expect(result.pulledEntries).toBe(1);
    expect(result.appliedEntries).toBe(0);
    expect(b.storage.get("works", "w1")).toBeNull();
    expect(await b.storage.getCursor("dev-a")).toBe(1);
  });

  it("allows a newer explicit restore to revive a deleted row", async () => {
    const remote = new MemorySyncProvider();
    let wallA = 1000;
    let wallB = 1000;
    const a = makeDevice("dev-a", remote, () => wallA);
    const b = makeDevice("dev-b", remote, () => wallB);

    a.storage.write("works", "w1", { title: "Shared", deleted_at: null }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();

    wallB = 2000;
    b.storage.deleteRow("works", "w1", b.clock.tick());
    await b.engine.sync();
    await a.engine.sync();
    expect(a.storage.get("works", "w1")).toBeNull();

    wallA = 3000;
    a.storage.write(
      "works",
      "w1",
      { title: "Restored on A", deleted_at: null },
      a.clock.tick(),
    );
    await a.engine.sync();
    await b.engine.sync();

    expect(a.storage.get("works", "w1")).toEqual({ title: "Restored on A", deleted_at: null });
    expect(b.storage.get("works", "w1")).toEqual({ title: "Restored on A", deleted_at: null });
  });

  it("applies straightforward deletes", async () => {
    const remote = new MemorySyncProvider();
    const a = makeDevice("dev-a", remote);
    const b = makeDevice("dev-b", remote);

    a.storage.write("notes", "n1", { text: "x" }, a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();
    expect(b.storage.get("notes", "n1")).not.toBeNull();

    a.storage.deleteRow("notes", "n1", a.clock.tick());
    await a.engine.sync();
    await b.engine.sync();
    expect(b.storage.get("notes", "n1")).toBeNull();
  });

  it("three devices converge", async () => {
    const remote = new MemorySyncProvider();
    const devices = [
      makeDevice("dev-a", remote),
      makeDevice("dev-b", remote),
      makeDevice("dev-c", remote),
    ];

    devices[0]!.storage.write("works", "w1", { title: "From A" }, devices[0]!.clock.tick());
    devices[1]!.storage.write("works", "w2", { title: "From B" }, devices[1]!.clock.tick());
    devices[2]!.storage.write("works", "w3", { title: "From C" }, devices[2]!.clock.tick());

    // Two sync rounds reach convergence for all-pairs propagation.
    for (let round = 0; round < 2; round++) {
      for (const d of devices) await d.engine.sync();
    }

    for (const d of devices) {
      expect(d.storage.get("works", "w1")).toEqual({ title: "From A" });
      expect(d.storage.get("works", "w2")).toEqual({ title: "From B" });
      expect(d.storage.get("works", "w3")).toEqual({ title: "From C" });
    }
  });

  it("splits large pushes into multiple segments", async () => {
    const remote = new MemorySyncProvider();
    const a = makeDevice("dev-a", remote);
    for (let i = 0; i < 1200; i++) {
      a.storage.write("works", `w${i}`, { title: `Paper ${i}` }, a.clock.tick());
    }
    await a.engine.push();
    const segments = await remote.list("journal/dev-a/");
    expect(segments.length).toBe(3); // 500 + 500 + 200

    const b = makeDevice("dev-b", remote);
    const result = await b.engine.pull();
    expect(result.appliedEntries).toBe(1200);
  });
});
