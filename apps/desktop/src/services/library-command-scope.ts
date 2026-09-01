import type { LibraryScopeToken } from "../../electron/data-command-contract";
import {
  MAX_LIBRARY_SCOPE_ID_BYTES,
  MAX_LIBRARY_SCOPE_TOKEN_BYTES,
  libraryScopeUtf8ByteLength,
} from "../shared/library-scope-limits";

/**
 * Resolves the durable local Library identity for typed mutation commands.
 * This replaces the generic renderer database bridge for command scoping.
 */
export async function getActiveLibraryCommandScope(): Promise<string> {
  return (await window.aura.data.command("library.getScope", {})).libraryId;
}

/**
 * Captures the opaque main-process generation used to reject late scoped
 * results. The legacy string helper above remains for mutation call sites
 * that have not migrated to generation binding yet.
 */
export async function getActiveLibraryCommandScopeToken(): Promise<LibraryScopeToken> {
  const value: unknown = await window.aura.data.command("library.getScope", {});
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.libraryId !== "string" ||
    !value.libraryId.trim() ||
    libraryScopeUtf8ByteLength(value.libraryId) > MAX_LIBRARY_SCOPE_ID_BYTES ||
    typeof value.scopeToken !== "string" ||
    !value.scopeToken.trim() ||
    libraryScopeUtf8ByteLength(value.scopeToken) > MAX_LIBRARY_SCOPE_TOKEN_BYTES
  ) {
    throw new Error("Library scope result is invalid");
  }
  return { libraryId: value.libraryId, scopeToken: value.scopeToken };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
