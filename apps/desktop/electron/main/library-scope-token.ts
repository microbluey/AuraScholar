import { randomUUID } from "node:crypto";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import type { LibraryScopeToken } from "../library-read-command-contract";
import {
  MAX_LIBRARY_SCOPE_ID_BYTES,
  libraryScopeUtf8ByteLength,
} from "../../src/shared/library-scope-limits";
import { assertActiveLocalLibrary } from "./data-command-runtime";

/**
 * Scope generations are deliberately process-local. A renderer can echo a
 * token to bind a late result to the snapshot that started it, but a restart
 * or an observed Library identity change always invalidates the old token.
 */
const scopes = new WeakMap<Database, LibraryScopeToken>();

export async function getActiveLibraryScopeToken(database: Database): Promise<LibraryScopeToken> {
  try {
    const libraryId = await requireLocalLibraryId(database);
    requireLibraryScopeId(libraryId);
    await assertActiveLocalLibrary(database, libraryId);
    const previous = scopes.get(database);
    if (previous?.libraryId === libraryId) return { ...previous };

    const next = { libraryId, scopeToken: randomUUID() } satisfies LibraryScopeToken;
    scopes.set(database, next);
    return { ...next };
  } catch (error) {
    // A deleted/malformed identity must not be able to resurrect its old
    // generation if the same id is repaired later in this process.
    scopes.delete(database);
    throw error;
  }
}

function requireLibraryScopeId(value: string): void {
  if (!value.trim() || libraryScopeUtf8ByteLength(value) > MAX_LIBRARY_SCOPE_ID_BYTES) {
    throw new Error("Local Library scope id is invalid");
  }
}

/** Resolves and validates the current generation inside the caller's lease. */
export async function assertActiveLibraryScopeToken(
  database: Database,
  expected: LibraryScopeToken,
): Promise<LibraryScopeToken> {
  const current = await getActiveLibraryScopeToken(database);
  if (current.libraryId !== expected.libraryId || current.scopeToken !== expected.scopeToken) {
    throw new Error("Rejected stale or foreign Library scope");
  }
  return current;
}
