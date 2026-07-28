import type { CollectionRow } from "@aurascholar/db";

export const LIBRARY_COLLECTION_EVENTS = {
  create: "aurascholar:create-collection",
  delete: "aurascholar:delete-collection",
  manage: "aurascholar:manage-collections",
  move: "aurascholar:move-collection",
  rename: "aurascholar:rename-collection",
} as const;

export type LibraryCollectionEventName =
  (typeof LIBRARY_COLLECTION_EVENTS)[keyof typeof LIBRARY_COLLECTION_EVENTS];

export interface CreateCollectionEventDetail {
  parentId?: string | null;
}

export interface MoveCollectionEventDetail {
  id: string;
  parentId: string | null;
  position: number;
}

export interface CollectionContextActionEventDetail {
  id: string;
  name: string;
}

export interface CollectionDeleteUndoState {
  id: string;
  name: string;
  workIds: string[];
  wasActive: boolean;
  message: string;
}

export interface CollectionManagerAction {
  id: string;
  kind: "create" | "delete" | "rename" | "restore";
}

export function moveCollectionRows(
  collections: CollectionRow[],
  detail: MoveCollectionEventDetail,
): CollectionRow[] {
  const moving = collections.find((collection) => collection.id === detail.id);
  if (!moving) return collections;

  const targetSiblings = collections
    .filter((collection) => collection.id !== detail.id && collection.parent_id === detail.parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN"));
  const position = Math.max(0, Math.min(Math.trunc(detail.position), targetSiblings.length));
  targetSiblings.splice(position, 0, { ...moving, parent_id: detail.parentId });
  const targetOrder = new Map(targetSiblings.map((collection, index) => [collection.id, index]));

  const previousSiblings = collections
    .filter(
      (collection) => collection.id !== detail.id && collection.parent_id === moving.parent_id,
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-CN"));
  const previousOrder = new Map(
    previousSiblings.map((collection, index) => [collection.id, index]),
  );

  return collections.map((collection) => {
    if (targetOrder.has(collection.id)) {
      return {
        ...collection,
        parent_id: detail.parentId,
        sort_order: targetOrder.get(collection.id)!,
      };
    }
    if (moving.parent_id !== detail.parentId && previousOrder.has(collection.id)) {
      return { ...collection, sort_order: previousOrder.get(collection.id)! };
    }
    return collection;
  });
}
