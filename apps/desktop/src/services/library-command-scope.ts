/**
 * Resolves the durable local Library identity for typed mutation commands.
 * This replaces the generic renderer database bridge for command scoping.
 */
export async function getActiveLibraryCommandScope(): Promise<string> {
  return (await window.aura.data.command("library.getScope", {})).libraryId;
}
