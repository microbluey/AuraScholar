import type { Database } from "./database.js";
import { newId } from "./ids.js";

/** Shared atomic primitive for nested database operations. */
export async function withDatabaseSavepoint<T>(
  db: Database,
  prefix: string,
  operation: () => Promise<T>,
): Promise<T> {
  const name = `${prefix}_${newId().replace(/-/g, "_")}`;
  await db.exec(`SAVEPOINT ${name}`);
  try {
    const result = await operation();
    await db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    try {
      await db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    } finally {
      await db.exec(`RELEASE SAVEPOINT ${name}`);
    }
    throw error;
  }
}
