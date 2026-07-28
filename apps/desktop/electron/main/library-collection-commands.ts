import type { Database } from "@aurascholar/db";
import { CollectionsRepo } from "@aurascholar/db/repos/collections";
import type {
  CollectionCommandInput,
  CreateCollectionCommandInput,
  DataCommandOutput,
  DataCommandRequest,
  MoveCollectionCommandInput,
  RenameCollectionCommandInput,
  RestoreCollectionCommandInput,
  SetWorksCollectionCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
  requireNullableRecordId,
  requireRecordId,
  requireUniqueRecordIds,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_COLLECTION_NAME_LENGTH = 256;

type LibraryCollectionCommandName =
  | "library.createCollection"
  | "library.deleteCollection"
  | "library.moveCollection"
  | "library.renameCollection"
  | "library.restoreCollection"
  | "library.setWorksCollection";

export type LibraryCollectionCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryCollectionCommandName }
>;

export async function executeLibraryCollectionCommand(
  request: LibraryCollectionCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryCollectionCommandName>> {
  switch (request.name) {
    case "library.createCollection": {
      const input = parseCreateCollectionInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const collectionId = await new CollectionsRepo(database, input.libraryId).create(
          input.name,
          input.parentId ?? undefined,
        );
        return { collectionId };
      });
    }
    case "library.deleteCollection": {
      const input = parseCollectionInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertCollectionDeleteUndoCapacity(database, input.libraryId, input.collectionId);
        return new CollectionsRepo(database, input.libraryId).softDelete(input.collectionId);
      });
    }
    case "library.moveCollection": {
      const input = parseMoveCollectionInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new CollectionsRepo(database, input.libraryId).move(
          input.collectionId,
          input.parentId,
          input.position,
        );
        return { updated: 1 };
      });
    }
    case "library.renameCollection": {
      const input = parseRenameCollectionInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new CollectionsRepo(database, input.libraryId).rename(input.collectionId, input.name);
        return { updated: 1 };
      });
    }
    case "library.restoreCollection": {
      const input = parseRestoreCollectionInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        return new CollectionsRepo(database, input.libraryId).restore(
          input.collectionId,
          input.workIds,
        );
      });
    }
    case "library.setWorksCollection": {
      const input = parseSetWorksCollectionInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const updated = await new CollectionsRepo(database, input.libraryId).setWorksCollection(
          input.workIds,
          input.collectionId,
        );
        if (updated !== input.workIds.length) {
          throw new Error("Collection assignment did not update every requested work");
        }
        return { updated };
      });
    }
  }
}

function parseCreateCollectionInput(value: unknown): CreateCollectionCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.createCollection input");
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    name: requireCollectionName(value.name),
    parentId: requireNullableRecordId(value.parentId, "Parent collection id"),
  };
}

function parseCollectionInput(value: unknown, commandName: string): CollectionCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    collectionId: requireRecordId(value.collectionId, "Collection id"),
    libraryId: requireRecordId(value.libraryId, "Library id"),
  };
}

function parseMoveCollectionInput(value: unknown): MoveCollectionCommandInput {
  const input = parseCollectionInput(value, "library.moveCollection");
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.position) || (record.position as number) < 0) {
    throw new Error("Collection position is invalid");
  }
  return {
    ...input,
    parentId: requireNullableRecordId(record.parentId, "Parent collection id"),
    position: record.position as number,
  };
}

function parseRenameCollectionInput(value: unknown): RenameCollectionCommandInput {
  const input = parseCollectionInput(value, "library.renameCollection");
  return {
    ...input,
    name: requireCollectionName((value as Record<string, unknown>).name),
  };
}

function parseRestoreCollectionInput(value: unknown): RestoreCollectionCommandInput {
  const input = parseCollectionInput(value, "library.restoreCollection");
  return {
    ...input,
    workIds: requireUniqueRecordIds((value as Record<string, unknown>).workIds, "Work id", {
      allowEmpty: true,
      max: MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
    }),
  };
}

function parseSetWorksCollectionInput(value: unknown): SetWorksCollectionCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.setWorksCollection input");
  return {
    collectionId: requireNullableRecordId(value.collectionId, "Collection id"),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    workIds: requireUniqueRecordIds(value.workIds, "Work id", {
      max: MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
    }),
  };
}

function requireCollectionName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Collection name is required");
  }
  const name = value.trim();
  if (name.length > MAX_COLLECTION_NAME_LENGTH) {
    throw new Error("Collection name is too long");
  }
  return name;
}

async function assertCollectionDeleteUndoCapacity(
  database: Database,
  libraryId: string,
  collectionId: string,
): Promise<void> {
  const rows = await database.query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM collection_items ci
     JOIN collections c
       ON c.id = ci.collection_id
      AND c.library_id = ?
      AND c.deleted_at IS NULL
     JOIN works w
       ON w.id = ci.work_id
      AND w.library_id = c.library_id
     WHERE ci.collection_id = ?`,
    [libraryId, collectionId],
  );
  if ((rows[0]?.count ?? 0) > MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS) {
    throw new Error(
      `Collection deletion is limited to ${MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS} associated works so it can be safely undone`,
    );
  }
}
