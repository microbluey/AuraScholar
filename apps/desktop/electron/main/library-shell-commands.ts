import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryGetShellStatsCommandResult,
  LibraryScopeCommandInput,
  LibraryShellCollection,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  type DataCommandDependencies,
} from "./data-command-runtime";

type LibraryShellCommandName = "library.getScope" | "library.getShellStats";

export type LibraryShellCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryShellCommandName }
>;

interface CollectionStatsRow {
  count: number;
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

/**
 * Scoped App Shell reads. The renderer has no authority to select a Library;
 * the durable local-first identity is resolved inside the coordinator lease.
 */
export async function executeLibraryShellCommand(
  request: LibraryShellCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryShellCommandName>> {
  switch (request.name) {
    case "library.getScope": {
      parseLibraryScopeInput(request.input, request.name);
      return executeLibraryShellQuery(dependencies, request.name, async (database) => ({
        libraryId: await requireActiveLocalLibraryId(database),
      }));
    }
    case "library.getShellStats": {
      parseLibraryScopeInput(request.input, request.name);
      return executeLibraryShellQuery(dependencies, request.name, async (database) =>
        loadLibraryShellStats(database, await requireActiveLocalLibraryId(database)),
      );
    }
  }
}

function executeLibraryShellQuery<K extends LibraryShellCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseLibraryScopeInput(
  value: unknown,
  commandName: LibraryShellCommandName,
): LibraryScopeCommandInput {
  if (!isRecord(value) || Object.keys(value).length > 0) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value as LibraryScopeCommandInput;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function loadLibraryShellStats(
  database: Database,
  libraryId: string,
): Promise<LibraryGetShellStatsCommandResult> {
  const [totalRows, trashRows, annotationRows, canvasNodeRows, snippetRows, collectionRows] =
    await Promise.all([
      database.query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM works
         WHERE library_id = ? AND deleted_at IS NULL`,
        [libraryId],
      ),
      database.query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM works
         WHERE library_id = ? AND deleted_at IS NOT NULL`,
        [libraryId],
      ),
      database.query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM annotations a
         JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
         WHERE w.library_id = ? AND a.deleted_at IS NULL`,
        [libraryId],
      ),
      database.query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM canvas_nodes n
         JOIN canvas_workspaces cw ON cw.id = n.workspace_id
         WHERE cw.library_id = ?`,
        [libraryId],
      ),
      database.query<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM snippets s
         JOIN works w ON w.id = s.work_id AND w.deleted_at IS NULL
         WHERE w.library_id = ? AND s.deleted_at IS NULL`,
        [libraryId],
      ),
      database.query<CollectionStatsRow>(
        `SELECT c.id, c.name, c.parent_id, c.sort_order, COUNT(w.id) AS count
         FROM collections c
         LEFT JOIN collection_items ci ON ci.collection_id = c.id
         LEFT JOIN works w
           ON w.id = ci.work_id
          AND w.library_id = c.library_id
          AND w.deleted_at IS NULL
         WHERE c.library_id = ? AND c.deleted_at IS NULL
         GROUP BY c.id, c.name, c.parent_id, c.sort_order
         ORDER BY c.sort_order, c.name, c.id`,
        [libraryId],
      ),
    ]);

  return {
    annotations: annotationRows[0]?.n ?? 0,
    canvasNodes: canvasNodeRows[0]?.n ?? 0,
    collections: collectionRows.map(toLibraryShellCollection),
    snippets: snippetRows[0]?.n ?? 0,
    total: totalRows[0]?.n ?? 0,
    trash: trashRows[0]?.n ?? 0,
  };
}

function toLibraryShellCollection(collection: CollectionStatsRow): LibraryShellCollection {
  return {
    count: collection.count,
    id: collection.id,
    name: collection.name,
    parentId: collection.parent_id,
    sortOrder: collection.sort_order,
  };
}
