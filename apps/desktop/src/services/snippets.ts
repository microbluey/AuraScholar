// Snippet service: capture excerpts while reading, browse them across the
// library for writing. Thin wrapper over SnippetsRepo + the desktop DB.
import {
  SnippetsRepo,
  type SnippetInput,
  type SnippetWithWork,
} from "@aurascholar/db/repos/snippets";
import { getDb } from "./aura-db";

export async function addSnippet(input: SnippetInput): Promise<void> {
  const db = await getDb();
  await new SnippetsRepo(db).create(input);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}

export async function listAllSnippets(): Promise<SnippetWithWork[]> {
  const db = await getDb();
  return new SnippetsRepo(db).listAll();
}

export async function updateSnippetNote(id: string, noteMd: string | null): Promise<void> {
  const db = await getDb();
  await new SnippetsRepo(db).updateNote(id, noteMd);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}

export async function deleteSnippet(id: string): Promise<void> {
  const db = await getDb();
  await new SnippetsRepo(db).softDelete(id);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}

export async function restoreSnippet(id: string): Promise<void> {
  const db = await getDb();
  await new SnippetsRepo(db).restore(id);
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}
