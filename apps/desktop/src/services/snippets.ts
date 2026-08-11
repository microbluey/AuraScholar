import type { SnippetWithWork } from "@aurascholar/db/repos/snippets";
import type { SnippetCreateCommandInput } from "../../electron/data-command-contract";

/**
 * Renderer facade for writing snippets. The main process resolves the active
 * local Library, keeping direct database access out of Reader and writing UI.
 */
export async function addSnippet(input: SnippetCreateCommandInput): Promise<void> {
  await window.aura.data.command("snippet.create", input);
  publishSnippetsUpdated();
}

export async function listAllSnippets(): Promise<SnippetWithWork[]> {
  return (await window.aura.data.command("snippet.listAll", {})).snippets;
}

export async function updateSnippetNote(id: string, noteMd: string | null): Promise<void> {
  await window.aura.data.command("snippet.updateNote", { noteMd, snippetId: id });
  publishSnippetsUpdated();
}

export async function deleteSnippet(id: string): Promise<void> {
  await window.aura.data.command("snippet.delete", { snippetId: id });
  publishSnippetsUpdated();
}

export async function restoreSnippet(id: string): Promise<void> {
  await window.aura.data.command("snippet.restore", { snippetId: id });
  publishSnippetsUpdated();
}

function publishSnippetsUpdated(): void {
  window.dispatchEvent(new Event("aurascholar:snippets-updated"));
}
