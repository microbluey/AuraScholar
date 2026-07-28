// Snippet service: capture excerpts while reading, browse them across the
// library for writing. Thin wrapper over SnippetsRepo + the desktop DB.
import {
  SnippetsRepo,
  type SnippetInput,
  type SnippetWithWork,
} from "@aurascholar/db/repos/snippets";
import { getLibraryDb } from "./aura-db";

export async function addSnippet(input: SnippetInput): Promise<void> {
  const { db, libraryId } = await getLibraryDb();
  await new SnippetsRepo(db, libraryId).create(input);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}

export async function listAllSnippets(): Promise<SnippetWithWork[]> {
  const { db, libraryId } = await getLibraryDb();
  return new SnippetsRepo(db, libraryId).listAll();
}

export async function updateSnippetNote(id: string, noteMd: string | null): Promise<void> {
  const { db, libraryId } = await getLibraryDb();
  await new SnippetsRepo(db, libraryId).updateNote(id, noteMd);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}

export async function deleteSnippet(id: string): Promise<void> {
  const { db, libraryId } = await getLibraryDb();
  await new SnippetsRepo(db, libraryId).softDelete(id);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}

export async function restoreSnippet(id: string): Promise<void> {
  const { db, libraryId } = await getLibraryDb();
  await new SnippetsRepo(db, libraryId).restore(id);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}
