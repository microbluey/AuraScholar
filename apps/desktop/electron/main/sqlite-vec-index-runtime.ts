import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { SqliteVecIndexStore } from "./sqlite-vec-index";

/** Main-process singleton for embedding jobs and hybrid retrieval. */
export const sqliteVecIndexStore = new SqliteVecIndexStore({
  inspect: withMainDatabase,
  transaction: withMainDatabaseTransaction,
});
