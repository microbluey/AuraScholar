import {
  LIBRARY_COLLECTION_EVENTS,
  type CollectionContextActionEventDetail,
  type CreateCollectionEventDetail,
  type MoveCollectionEventDetail,
} from "./library-collection-model";

export function requestCreateLibraryCollection(parentId?: string | null): void {
  window.dispatchEvent(
    new CustomEvent<CreateCollectionEventDetail>(LIBRARY_COLLECTION_EVENTS.create, {
      detail: { parentId: parentId ?? null },
    }),
  );
}

export function requestRenameLibraryCollection(detail: CollectionContextActionEventDetail): void {
  window.dispatchEvent(
    new CustomEvent<CollectionContextActionEventDetail>(LIBRARY_COLLECTION_EVENTS.rename, {
      detail,
    }),
  );
}

export function requestDeleteLibraryCollection(detail: CollectionContextActionEventDetail): void {
  window.dispatchEvent(
    new CustomEvent<CollectionContextActionEventDetail>(LIBRARY_COLLECTION_EVENTS.delete, {
      detail,
    }),
  );
}

export function requestMoveLibraryCollection(detail: MoveCollectionEventDetail): void {
  window.dispatchEvent(
    new CustomEvent<MoveCollectionEventDetail>(LIBRARY_COLLECTION_EVENTS.move, { detail }),
  );
}
