import type { Database } from "@aurascholar/db";
import type {
  CitationGraphGetActiveLibraryDoisCommandInput,
  CitationGraphGetActiveLibraryDoisCommandResult,
} from "../citation-graph-command-contract";
import type { LibraryScopeToken } from "../library-read-command-contract";

export async function loadActiveLibraryDois(
  database: Database,
  scope: LibraryScopeToken,
  input: CitationGraphGetActiveLibraryDoisCommandInput,
): Promise<CitationGraphGetActiveLibraryDoisCommandResult> {
  if (input.dois.length === 0) return { dois: [], scope: { ...scope } };
  const placeholders = input.dois.map(() => "?").join(",");
  const rows = await database.query<{ doi: string }>(
    `SELECT DISTINCT doi
     FROM works
     WHERE library_id = ?
       AND doi IN (${placeholders})
       AND deleted_at IS NULL
     ORDER BY doi`,
    [scope.libraryId, ...input.dois],
  );
  return { dois: rows.map((row) => row.doi), scope: { ...scope } };
}
