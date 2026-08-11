import type { ReadingStatus } from "@aurascholar/db";
import { getActiveLibraryCommandScope } from "./library-command-scope";

export async function setLibraryWorkStarred(workId: string, starred: boolean): Promise<void> {
  await window.aura.data.command("library.setWorkStarred", {
    libraryId: await getActiveLibraryCommandScope(),
    starred,
    workId,
  });
}

export async function setLibraryWorkReadingStatus(
  workId: string,
  status: ReadingStatus,
): Promise<void> {
  await window.aura.data.command("library.setWorkReadingStatus", {
    libraryId: await getActiveLibraryCommandScope(),
    status,
    workId,
  });
}

export async function trashLibraryWorks(workIds: string[]): Promise<void> {
  await window.aura.data.command("library.trashWorks", {
    libraryId: await getActiveLibraryCommandScope(),
    workIds,
  });
}

export async function restoreLibraryWorks(workIds: string[]): Promise<void> {
  await window.aura.data.command("library.restoreWorks", {
    libraryId: await getActiveLibraryCommandScope(),
    workIds,
  });
}

export async function purgeLibraryWorks(workIds: string[]): Promise<void> {
  await window.aura.data.command("library.purgeDeletedWorks", {
    libraryId: await getActiveLibraryCommandScope(),
    workIds,
  });
}

export async function mergeLibraryWorks(primaryId: string, duplicateIds: string[]) {
  return window.aura.data.command("library.mergeWorks", {
    duplicateIds,
    libraryId: await getActiveLibraryCommandScope(),
    primaryId,
  });
}
