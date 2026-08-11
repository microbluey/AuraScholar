import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { TagsRepo, type TagRow } from "@aurascholar/db/repos/tags";
import type {
  AddTagToWorksCommandInput,
  CreateTagCommandInput,
  DataCommandOutput,
  DataCommandRequest,
  LibraryListTagsCommandResult,
  LibraryScopeCommandInput,
  LibraryTagSummary,
  RenameTagCommandInput,
  RestoreTagCommandInput,
  SetTagColorCommandInput,
  TagCommandInput,
} from "../data-command-contract";
import {
  assertActiveLocalLibrary,
  isRecord,
  MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
  requireRecordId,
  requireUniqueRecordIds,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_TAG_NAME_LENGTH = 256;
const MAX_TAG_COLOR_LENGTH = 64;

type LibraryTagCommandName =
  | "library.addTagToWorks"
  | "library.createTag"
  | "library.deleteTag"
  | "library.listTags"
  | "library.renameTag"
  | "library.restoreTag"
  | "library.setTagColor";

export type LibraryTagCommandRequest = Extract<DataCommandRequest, { name: LibraryTagCommandName }>;

export async function executeLibraryTagCommand(
  request: LibraryTagCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryTagCommandName>> {
  switch (request.name) {
    case "library.listTags": {
      parseLibraryScopeInput(request.input);
      return executeLibraryTagQuery(dependencies, request.name, async (database) => {
        const libraryId = await requireLocalLibraryId(database);
        await assertActiveLocalLibrary(database, libraryId);
        return { tags: (await new TagsRepo(database, libraryId).list()).map(toLibraryTagSummary) };
      });
    }
    case "library.addTagToWorks": {
      const input = parseAddTagToWorksInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const tagId = await new TagsRepo(database, input.libraryId).addToWorks(
          input.workIds,
          input.name,
        );
        if (!tagId) throw new Error("Tag assignment did not produce a tag");
        return { tagId, updated: input.workIds.length };
      });
    }
    case "library.createTag": {
      const input = parseCreateTagInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const tagId = await new TagsRepo(database, input.libraryId).ensure(input.name, input.color);
        return { tagId, updated: 1 };
      });
    }
    case "library.deleteTag": {
      const input = parseTagInput(request.input, request.name);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertTagDeleteUndoCapacity(database, input.libraryId, input.tagId);
        const workIds = await new TagsRepo(database, input.libraryId).softDelete(input.tagId);
        return { workIds };
      });
    }
    case "library.renameTag": {
      const input = parseRenameTagInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const tagId = await new TagsRepo(database, input.libraryId).rename(input.tagId, input.name);
        return { tagId, updated: 1 };
      });
    }
    case "library.restoreTag": {
      const input = parseRestoreTagInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        const updated = await new TagsRepo(database, input.libraryId).restore(
          input.tagId,
          input.workIds,
        );
        return { tagId: input.tagId, updated };
      });
    }
    case "library.setTagColor": {
      const input = parseSetTagColorInput(request.input);
      return dependencies.transaction(request.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await new TagsRepo(database, input.libraryId).setColor(input.tagId, input.color);
        return { updated: 1 };
      });
    }
  }
}

function executeLibraryTagQuery(
  dependencies: DataCommandDependencies,
  commandName: "library.listTags",
  operation: (
    database: Database,
  ) => LibraryListTagsCommandResult | Promise<LibraryListTagsCommandResult>,
): Promise<LibraryListTagsCommandResult> {
  if (!dependencies.execute) {
    throw new Error("Main-process database query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function parseLibraryScopeInput(value: unknown): LibraryScopeCommandInput {
  if (!isRecord(value) || Object.keys(value).length > 0) {
    throw new Error("Invalid library.listTags input");
  }
  return value as LibraryScopeCommandInput;
}

function toLibraryTagSummary(tag: TagRow): LibraryTagSummary {
  return { color: tag.color, count: tag.count, id: tag.id, name: tag.name };
}

function parseAddTagToWorksInput(value: unknown): AddTagToWorksCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.addTagToWorks input");
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    name: requireTagName(value.name),
    workIds: requireUniqueRecordIds(value.workIds, "Work id", {
      max: MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
    }),
  };
}

function parseCreateTagInput(value: unknown): CreateTagCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.createTag input");
  return {
    color: value.color === undefined ? undefined : (requireTagColor(value.color) ?? undefined),
    libraryId: requireRecordId(value.libraryId, "Library id"),
    name: requireTagName(value.name),
  };
}

function parseTagInput(value: unknown, commandName: string): TagCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  return {
    libraryId: requireRecordId(value.libraryId, "Library id"),
    tagId: requireRecordId(value.tagId, "Tag id"),
  };
}

function parseRenameTagInput(value: unknown): RenameTagCommandInput {
  const input = parseTagInput(value, "library.renameTag");
  return { ...input, name: requireTagName((value as Record<string, unknown>).name) };
}

function parseRestoreTagInput(value: unknown): RestoreTagCommandInput {
  const input = parseTagInput(value, "library.restoreTag");
  return {
    ...input,
    workIds: requireUniqueRecordIds((value as Record<string, unknown>).workIds, "Work id", {
      allowEmpty: true,
      max: MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS,
    }),
  };
}

function parseSetTagColorInput(value: unknown): SetTagColorCommandInput {
  const input = parseTagInput(value, "library.setTagColor");
  return {
    ...input,
    color: requireTagColor((value as Record<string, unknown>).color),
  };
}

function requireTagName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Tag name is required");
  const name = value.trim();
  if (name.length > MAX_TAG_NAME_LENGTH) throw new Error("Tag name is too long");
  return name;
}

function requireTagColor(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_TAG_COLOR_LENGTH) {
    throw new Error("Tag color is invalid");
  }
  return value;
}

async function assertTagDeleteUndoCapacity(
  database: Database,
  libraryId: string,
  tagId: string,
): Promise<void> {
  const rows = await database.query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM work_tags wt
     JOIN tags t
       ON t.id = wt.tag_id
      AND t.library_id = ?
      AND t.deleted_at IS NULL
     JOIN works w
       ON w.id = wt.work_id
      AND w.library_id = t.library_id
     WHERE wt.tag_id = ?`,
    [libraryId, tagId],
  );
  if ((rows[0]?.count ?? 0) > MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS) {
    throw new Error(
      `Tag deletion is limited to ${MAX_LIBRARY_ORGANIZATION_UNDO_WORK_IDS} associated works so it can be safely undone`,
    );
  }
}
