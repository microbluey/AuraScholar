import type { LibraryTagSummary } from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";

export type LibraryTag = LibraryTagSummary;

export async function listLibraryTags(): Promise<LibraryTag[]> {
  return (await window.aura.data.command("library.listTags", {})).tags;
}

export async function createLibraryCollection(
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const result = await window.aura.data.command("library.createCollection", {
    libraryId: await getActiveLibraryCommandScope(),
    name,
    parentId,
  });
  return result.collectionId;
}

export async function renameLibraryCollection(collectionId: string, name: string): Promise<void> {
  await window.aura.data.command("library.renameCollection", {
    collectionId,
    libraryId: await getActiveLibraryCommandScope(),
    name,
  });
}

export async function moveLibraryCollection(
  collectionId: string,
  parentId: string | null,
  position: number,
): Promise<void> {
  await window.aura.data.command("library.moveCollection", {
    collectionId,
    libraryId: await getActiveLibraryCommandScope(),
    parentId,
    position,
  });
}

export async function deleteLibraryCollection(
  collectionId: string,
): Promise<{ workIds: string[] }> {
  return window.aura.data.command("library.deleteCollection", {
    collectionId,
    libraryId: await getActiveLibraryCommandScope(),
  });
}

export async function restoreLibraryCollection(
  collectionId: string,
  workIds: string[],
): Promise<{ restoredWorkIds: string[]; skippedWorkIds: string[] }> {
  return window.aura.data.command("library.restoreCollection", {
    collectionId,
    libraryId: await getActiveLibraryCommandScope(),
    workIds,
  });
}

export async function setWorksLibraryCollection(
  workIds: string[],
  collectionId: string | null,
): Promise<number> {
  const result = await window.aura.data.command("library.setWorksCollection", {
    collectionId,
    libraryId: await getActiveLibraryCommandScope(),
    workIds,
  });
  return result.updated;
}

export async function createLibraryTag(name: string, color?: string): Promise<string> {
  const result = await window.aura.data.command("library.createTag", {
    color,
    libraryId: await getActiveLibraryCommandScope(),
    name,
  });
  return result.tagId;
}

export async function renameLibraryTag(tagId: string, name: string): Promise<string> {
  const result = await window.aura.data.command("library.renameTag", {
    libraryId: await getActiveLibraryCommandScope(),
    name,
    tagId,
  });
  return result.tagId;
}

export async function setLibraryTagColor(tagId: string, color: string | null): Promise<void> {
  await window.aura.data.command("library.setTagColor", {
    color,
    libraryId: await getActiveLibraryCommandScope(),
    tagId,
  });
}

export async function deleteLibraryTag(tagId: string): Promise<{ workIds: string[] }> {
  return window.aura.data.command("library.deleteTag", {
    libraryId: await getActiveLibraryCommandScope(),
    tagId,
  });
}

export async function restoreLibraryTag(tagId: string, workIds: string[]): Promise<number> {
  const result = await window.aura.data.command("library.restoreTag", {
    libraryId: await getActiveLibraryCommandScope(),
    tagId,
    workIds,
  });
  return result.updated;
}

export async function addLibraryTagToWorks(
  workIds: string[],
  name: string,
): Promise<{ tagId: string; updated: number }> {
  return window.aura.data.command("library.addTagToWorks", {
    libraryId: await getActiveLibraryCommandScope(),
    name,
    workIds,
  });
}
