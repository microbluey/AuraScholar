import type { Database } from "../database.js";

const databaseWriteQueues = new WeakMap<Database, Promise<void>>();
const activeDatabaseWriteTokens = new WeakMap<Database, DatabaseWriteLockToken>();

/**
 * An explicit capability for repository calls that are already inside the
 * database write queue. The token is intentionally opaque: callers can only
 * obtain one from `withDatabaseWriteLock` and must pass it down explicitly.
 */
export interface DatabaseWriteLockToken {
  readonly __databaseWriteLockToken: unique symbol;
}

/**
 * Serializes repository writes that opt into this guard and share one Database
 * wrapper. Works, tags, and collections must use the same queue because a
 * savepoint owned by any one of them can otherwise capture another's write.
 *
 * Desktop durable commands additionally hold the main-process coordinator for
 * their full transaction. This queue protects tests and non-Electron adapters
 * from interleaving these repository-owned savepoints across domains.
 *
 * Nested repository mutations must pass the explicit token they received from
 * the outer lock. Calls without that capability remain queued, so unrelated
 * operations cannot accidentally enter a transaction that is already active.
 * The token is linear: pass it only to awaited nested calls while the outer
 * callback is active; do not retain it or use it concurrently after return.
 */
export function withDatabaseWriteLock<T>(
  db: Database,
  fn: (token: DatabaseWriteLockToken) => Promise<T>,
  token?: DatabaseWriteLockToken,
): Promise<T> {
  const activeToken = activeDatabaseWriteTokens.get(db);
  if (token) {
    if (activeToken !== token) {
      return Promise.reject(new Error("Database write lock token is not active"));
    }
    // Normalize synchronous callback throws to a rejected Promise, matching
    // the queued path and keeping the lock API consistently async.
    return Promise.resolve().then(() => fn(token));
  }

  const previous = databaseWriteQueues.get(db) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const ownedToken = {} as DatabaseWriteLockToken;
      activeDatabaseWriteTokens.set(db, ownedToken);
      try {
        return await fn(ownedToken);
      } finally {
        if (activeDatabaseWriteTokens.get(db) === ownedToken) {
          activeDatabaseWriteTokens.delete(db);
        }
      }
    });
  databaseWriteQueues.set(
    db,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
