// Bibliographic metadata service: load a work's full field set + author list
// (with roles) for the detail panel and editor, and persist edits.
import type { WorkPatch } from "@aurascholar/db/repos/works";
import type { WorkMetadataSnapshot } from "../../electron/data-command-contract";

/** Kept as the existing renderer-facing metadata API. */
export interface WorkMetadata extends WorkMetadataSnapshot {
  authors: WorkMetadataSnapshot["authors"];
  keywords: WorkMetadataSnapshot["keywords"];
  work: WorkMetadataSnapshot["work"];
}

export async function loadWorkMetadata(workId: string): Promise<WorkMetadata | null> {
  return (await window.aura.data.command("library.getWorkMetadata", { workId })).metadata;
}

export async function saveWorkMetadata(workId: string, patch: WorkPatch): Promise<void> {
  await window.aura.data.command("library.updateWorkMetadata", { patch, workId });
  window.dispatchEvent(new Event("aurascholar:library-updated"));
}
