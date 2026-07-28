import type { TagRow } from "@aurascholar/db";
import { TagsRepo } from "@aurascholar/db/repos/tags";
import { getLibraryDb } from "./aura-db";

async function commandScope(): Promise<string> {
  return (await getLibraryDb()).libraryId;
}

export async function listLibraryTags(): Promise<TagRow[]> {
  const { db, libraryId } = await getLibraryDb();
  return new TagsRepo(db, libraryId).list();
}

export async function createLibraryCollection(
  name: string,
  parentId: string | null = null,
): Promise<string> {
  const result = await window.aura.data.command("library.createCollection", {
    libraryId: await commandScope(),
    name,
    parentId,
  });
  return result.collectionId;
}

export async function renameLibraryCollection(collectionId: string, name: string): Promise<void> {
  await window.aura.data.command("library.renameCollection", {
    collectionId,
    libraryId: await commandScope(),
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
    libraryId: await commandScope(),
    parentId,
    position,
  });
}

export async function deleteLibraryCollection(
  collectionId: string,
): Promise<{ workIds: string[] }> {
  return window.aura.data.command("library.deleteCollection", {
    collectionId,
    libraryId: await commandScope(),
  });
}

export async function restoreLibraryCollection(
  collectionId: string,
  workIds: string[],
): Promise<{ restoredWorkIds: string[]; skippedWorkIds: string[] }> {
  return window.aura.data.command("library.restoreCollection", {
    collectionId,
    libraryId: await commandScope(),
    workIds,
  });
}

export async function setWorksLibraryCollection(
  workIds: string[],
  collectionId: string | null,
): Promise<number> {
  const result = await window.aura.data.command("library.setWorksCollection", {
    collectionId,
    libraryId: await commandScope(),
    workIds,
  });
  return result.updated;
}

export async function createLibraryTag(name: string, color?: string): Promise<string> {
  const result = await window.aura.data.command("library.createTag", {
    color,
    libraryId: await commandScope(),
    name,
  });
  return result.tagId;
}

export async function renameLibraryTag(tagId: string, name: string): Promise<string> {
  const result = await window.aura.data.command("library.renameTag", {
    libraryId: await commandScope(),
    name,
    tagId,
  });
  return result.tagId;
}

export async function setLibraryTagColor(tagId: string, color: string | null): Promise<void> {
  await window.aura.data.command("library.setTagColor", {
    color,
    libraryId: await commandScope(),
    tagId,
  });
}

export async function deleteLibraryTag(tagId: string): Promise<{ workIds: string[] }> {
  return window.aura.data.command("library.deleteTag", {
    libraryId: await commandScope(),
    tagId,
  });
}

export async function restoreLibraryTag(tagId: string, workIds: string[]): Promise<number> {
  const result = await window.aura.data.command("library.restoreTag", {
    libraryId: await commandScope(),
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
    libraryId: await commandScope(),
    name,
    workIds,
  });
}
