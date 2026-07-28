import type { ReadingStatus } from "@aurascholar/db";
import { getLibraryDb } from "./aura-db";

async function activeLibraryId(): Promise<string> {
  return (await getLibraryDb()).libraryId;
}

export async function setLibraryWorkStarred(workId: string, starred: boolean): Promise<void> {
  await window.aura.data.command("library.setWorkStarred", {
    libraryId: await activeLibraryId(),
    starred,
    workId,
  });
}

export async function setLibraryWorkReadingStatus(
  workId: string,
  status: ReadingStatus,
): Promise<void> {
  await window.aura.data.command("library.setWorkReadingStatus", {
    libraryId: await activeLibraryId(),
    status,
    workId,
  });
}

export async function trashLibraryWorks(workIds: string[]): Promise<void> {
  await window.aura.data.command("library.trashWorks", {
    libraryId: await activeLibraryId(),
    workIds,
  });
}

export async function restoreLibraryWorks(workIds: string[]): Promise<void> {
  await window.aura.data.command("library.restoreWorks", {
    libraryId: await activeLibraryId(),
    workIds,
  });
}

export async function purgeLibraryWorks(workIds: string[]): Promise<void> {
  await window.aura.data.command("library.purgeDeletedWorks", {
    libraryId: await activeLibraryId(),
    workIds,
  });
}

export async function mergeLibraryWorks(primaryId: string, duplicateIds: string[]) {
  return window.aura.data.command("library.mergeWorks", {
    duplicateIds,
    libraryId: await activeLibraryId(),
    primaryId,
  });
}
