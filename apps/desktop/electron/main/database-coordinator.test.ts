import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@aurascholar/db";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { DatabaseCoordinator } from "./database-coordinator";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T = void>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
}

interface ProbeRow {
  id: string;
  value: string;
}

describe("DatabaseCoordinator", () => {
  let database: Database;
  let coordinator: DatabaseCoordinator;

  beforeEach(async () => {
    database = await createNodeDatabase(":memory:");
    await runMigrations(database);
    await database.exec(`
      CREATE TABLE coordinator_probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    coordinator = new DatabaseCoordinator(database);
  });

  it("holds queued raw reads and writes until an active unit of work commits", async () => {
    const entered = deferred();
    const release = deferred();
    const transaction = coordinator.transaction("probe.commit", async (transactionDatabase) => {
      await transactionDatabase.run("INSERT INTO coordinator_probe (id, value) VALUES (?, ?)", [
        "transaction",
        "committed",
      ]);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    let readSettled = false;
    let writeSettled = false;
    const read = coordinator
      .query<ProbeRow>("SELECT id, value FROM coordinator_probe ORDER BY id")
      .then((rows) => {
        readSettled = true;
        return rows;
      });
    const write = coordinator
      .run("INSERT INTO coordinator_probe (id, value) VALUES (?, ?)", ["queued", "preserved"])
      .then((changes) => {
        writeSettled = true;
        return changes;
      });

    await drainMicrotasks();
    expect(readSettled).toBe(false);
    expect(writeSettled).toBe(false);

    release.resolve();
    await transaction;

    expect(await read).toEqual([{ id: "transaction", value: "committed" }]);
    expect(await write).toBe(1);
  });

  it("rolls back a failed unit of work without losing the queued write", async () => {
    const entered = deferred();
    const release = deferred();
    const originalError = new Error("command failed");
    const transaction = coordinator.transaction("probe.rollback", async (transactionDatabase) => {
      await transactionDatabase.run("INSERT INTO coordinator_probe (id, value) VALUES (?, ?)", [
        "rolled-back",
        "discarded",
      ]);
      entered.resolve();
      await release.promise;
      throw originalError;
    });
    await entered.promise;

    const queuedWrite = coordinator.run("INSERT INTO coordinator_probe (id, value) VALUES (?, ?)", [
      "after-error",
      "preserved",
    ]);
    release.resolve();

    await expect(transaction).rejects.toBe(originalError);
    expect(await queuedWrite).toBe(1);
    await expect(
      coordinator.query<ProbeRow>("SELECT id, value FROM coordinator_probe ORDER BY id"),
    ).resolves.toEqual([{ id: "after-error", value: "preserved" }]);
  });

  it("makes successful transaction writes visible to the next queued read", async () => {
    await coordinator.transaction("probe.visible", async (transactionDatabase) => {
      await transactionDatabase.run("INSERT INTO coordinator_probe (id, value) VALUES (?, ?)", [
        "visible",
        "after-commit",
      ]);
    });

    await expect(
      coordinator.query<ProbeRow>("SELECT id, value FROM coordinator_probe"),
    ).resolves.toEqual([{ id: "visible", value: "after-commit" }]);
  });

  it("continues processing the queue after a raw operation fails", async () => {
    const failed = coordinator.run("INSERT INTO missing_table (id) VALUES (?)", ["failure"]);
    const recovered = coordinator.run("INSERT INTO coordinator_probe (id, value) VALUES (?, ?)", [
      "recovered",
      "queued",
    ]);

    await expect(failed).rejects.toThrow();
    await expect(recovered).resolves.toBe(1);
    await expect(
      coordinator.query<ProbeRow>("SELECT id, value FROM coordinator_probe"),
    ).resolves.toEqual([{ id: "recovered", value: "queued" }]);
  });

  it("retains both the command and rollback errors when cleanup fails", async () => {
    const commandError = new Error("command failed");
    const rollbackError = new Error("rollback failed");
    const entered = deferred();
    const release = deferred();
    let underlyingTouches = 0;
    const rollbackFailingDatabase: Database = {
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
        underlyingTouches += 1;
        return database.query<T>(sql, params);
      },
      async run(sql, params = []) {
        underlyingTouches += 1;
        return database.run(sql, params);
      },
      async exec(sql) {
        underlyingTouches += 1;
        if (sql === "ROLLBACK") throw rollbackError;
        await database.exec(sql);
      },
      async queryScalar(sql) {
        underlyingTouches += 1;
        return database.queryScalar(sql);
      },
    };
    const failingCoordinator = new DatabaseCoordinator(rollbackFailingDatabase);

    const result = failingCoordinator.transaction("probe.rollback-failure", async () => {
      entered.resolve();
      await release.promise;
      throw commandError;
    });
    await entered.promise;
    const queuedOperation = failingCoordinator.run(
      "INSERT INTO coordinator_probe (id, value) VALUES (?, ?)",
      ["must-not-run", "queued-before-poison"],
    );
    release.resolve();

    await expect(result).rejects.toMatchObject({
      cause: commandError,
      errors: [commandError, rollbackError],
    });
    await expect(queuedOperation).rejects.toMatchObject({
      message:
        'Database connection is unavailable because command "probe.rollback-failure" could not be rolled back',
    });

    const touchesAfterRollbackFailure = underlyingTouches;
    const operationsAfterPoison = [
      failingCoordinator.execute(() => "must-not-run"),
      failingCoordinator.query("SELECT * FROM coordinator_probe"),
      failingCoordinator.run(
        "INSERT INTO coordinator_probe (id, value) VALUES ('must-not-run', 'poisoned')",
      ),
      failingCoordinator.exec("SELECT 1"),
      failingCoordinator.queryScalar("SELECT 1"),
      failingCoordinator.transaction("probe.after-poison", () => "must-not-run"),
    ];
    const settled = await Promise.allSettled(operationsAfterPoison);

    expect(settled).toHaveLength(6);
    expect(settled.every((item) => item.status === "rejected")).toBe(true);
    expect(underlyingTouches).toBe(touchesAfterRollbackFailure);

    // The coordinator deliberately cannot recover this connection; direct test
    // cleanup only prevents the in-memory database from retaining an open txn.
    await database.exec("ROLLBACK");
  });

  it("rejects a high-level transaction before its command body when a transaction exists", async () => {
    await database.exec("BEGIN");
    let commandBodyCalls = 0;

    await expect(
      coordinator.transaction("probe.external-transaction", async (transactionDatabase) => {
        commandBodyCalls += 1;
        await transactionDatabase.run(
          "INSERT INTO coordinator_probe (id, value) VALUES ('must-not-run', 'external')",
        );
      }),
    ).rejects.toThrow();

    expect(commandBodyCalls).toBe(0);
    await expect(
      database.query<ProbeRow>("SELECT id, value FROM coordinator_probe"),
    ).resolves.toEqual([]);
    await database.exec("ROLLBACK");
  });
});
