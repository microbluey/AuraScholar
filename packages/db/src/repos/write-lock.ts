import type { Database } from "../database.js";

const databaseWriteQueues = new WeakMap<Database, Promise<void>>();

/**
 * Serializes repository writes that opt into this guard and share one Database
 * wrapper. Works, tags, and collections must use the same queue because a
 * savepoint owned by any one of them can otherwise capture another's write.
 *
 * Desktop durable commands additionally hold the main-process coordinator for
 * their full transaction. This queue protects tests and non-Electron adapters
 * from interleaving these repository-owned savepoints across domains.
 *
 * The guard is deliberately not re-entrant. Locked operations must call private
 * unlocked helpers instead of another public repository mutation.
 */
export function withDatabaseWriteLock<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  const previous = databaseWriteQueues.get(db) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  databaseWriteQueues.set(
    db,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
