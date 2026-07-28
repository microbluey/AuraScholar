import type { Database } from "@aurascholar/db";

export type DatabaseOperation<T> = (database: Database) => Promise<T> | T;

/**
 * Serializes every operation that touches one SQLite connection.
 *
 * Transaction callbacks receive the underlying database because calling the
 * coordinator again from inside an active transaction would enqueue behind
 * that same transaction and deadlock.
 */
export class DatabaseCoordinator implements Database {
  private readonly databasePromise: Promise<Database>;
  private poisonedError: Error | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(database: Database | PromiseLike<Database>) {
    this.databasePromise = Promise.resolve(database);
  }

  execute<T>(operation: DatabaseOperation<T>): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.poisonedError) throw this.poisonedError;
      return operation(await this.databasePromise);
    });
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  transaction<T>(commandName: string, operation: DatabaseOperation<T>): Promise<T> {
    return this.execute(async (database) => {
      // Keep the command name in the API so callers must identify durable
      // commands, ready for tracing without changing transaction semantics.
      void commandName;
      await database.exec("BEGIN IMMEDIATE");
      try {
        const result = await operation(database);
        await database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          await database.exec("ROLLBACK");
        } catch (rollbackError) {
          const commandError = new AggregateError(
            [error, rollbackError],
            `Database command "${commandName}" failed and its rollback also failed`,
            { cause: error },
          );
          this.poisonedError = new Error(
            `Database connection is unavailable because command "${commandName}" could not be rolled back`,
            { cause: commandError },
          );
          throw commandError;
        }
        throw error;
      }
    });
  }

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.execute((database) => database.query<T>(sql, params));
  }

  run(sql: string, params: unknown[] = []): Promise<number> {
    return this.execute((database) => database.run(sql, params));
  }

  exec(sql: string): Promise<void> {
    return this.execute((database) => database.exec(sql));
  }

  queryScalar(sql: string): Promise<unknown> {
    return this.execute((database) => database.queryScalar(sql));
  }
}
