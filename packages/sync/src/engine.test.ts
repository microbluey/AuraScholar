import { describe, expect, it } from "vitest";
import { SyncEngine } from "./engine";
import { HlcClock } from "./hlc";
import { MemorySyncProvider } from "./memory-provider";
import { MemorySyncStorage } from "./memory-storage";

function makeDevice(deviceId: string, provider: MemorySyncProvider, wall?: () => number) {
  const clock = new HlcClock(deviceId, wall);
  const storage = new MemorySyncStorage(deviceId);
  const engine = new SyncEngine(provider, storage, deviceId, clock);
  return { clock, storage, engine };
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
