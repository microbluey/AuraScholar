import type { MergeWorksResult, ReadingStatus } from "@aurascholar/db/repos/works";
import type { ApplyRemoteSegmentCommand, ApplyRemoteSegmentResult } from "@aurascholar/sync";
import type { LibraryBackupImportSummary } from "../src/shared/library-backup";

export interface SetWorkReadingStatusCommandInput {
  libraryId: string;
  status: ReadingStatus;
  workId: string;
}

export interface SetWorkStarredCommandInput {
  libraryId: string;
  starred: boolean;
  workId: string;
}

export interface WorkIdsCommandInput {
  libraryId: string;
  workIds: string[];
}

export interface WorkMutationCountResult {
  updated: number;
}

export interface LibraryScopedCommandInput {
  libraryId: string;
}

export interface CreateCollectionCommandInput extends LibraryScopedCommandInput {
  name: string;
  parentId: string | null;
}

export interface CollectionCommandInput extends LibraryScopedCommandInput {
  collectionId: string;
}

export interface RenameCollectionCommandInput extends CollectionCommandInput {
  name: string;
}

export interface MoveCollectionCommandInput extends CollectionCommandInput {
  parentId: string | null;
  position: number;
}

export interface SetWorksCollectionCommandInput extends LibraryScopedCommandInput {
  collectionId: string | null;
  workIds: string[];
}

export interface RestoreCollectionCommandInput extends CollectionCommandInput {
  workIds: string[];
}

export interface CollectionDeleteCommandResult {
  workIds: string[];
}

export interface CollectionRestoreCommandResult {
  restoredWorkIds: string[];
  skippedWorkIds: string[];
}

export interface CreateTagCommandInput extends LibraryScopedCommandInput {
  color?: string;
  name: string;
}

export interface TagCommandInput extends LibraryScopedCommandInput {
  tagId: string;
}

export interface RenameTagCommandInput extends TagCommandInput {
  name: string;
}

export interface SetTagColorCommandInput extends TagCommandInput {
  color: string | null;
}

export interface RestoreTagCommandInput extends TagCommandInput {
  workIds: string[];
}

export interface AddTagToWorksCommandInput extends LibraryScopedCommandInput {
  name: string;
  workIds: string[];
}

export interface TagDeleteCommandResult {
  workIds: string[];
}

export interface TagMutationResult {
  tagId: string;
  updated: number;
}

export interface PurgeDeletedWorksCommandInput {
  libraryId: string;
  workIds: string[];
}

export interface PurgeDeletedWorksCommandResult {
  purged: number;
}

export interface MergeWorksCommandInput {
  libraryId: string;
  primaryId: string;
  duplicateIds: string[];
}

export type MergeWorksCommandResult = MergeWorksResult;

export interface ImportLibraryBackupCommandInput {
  backupText: string;
  libraryId: string;
}

export interface ApplyRemoteSyncSegmentCommandInput {
  libraryId: string;
  providerScope: string;
  segment: ApplyRemoteSegmentCommand;
}

export interface DataCommandMap {
  "library.addTagToWorks": {
    input: AddTagToWorksCommandInput;
    output: TagMutationResult;
  };
  "library.createCollection": {
    input: CreateCollectionCommandInput;
    output: { collectionId: string };
  };
  "library.createTag": {
    input: CreateTagCommandInput;
    output: TagMutationResult;
  };
  "library.deleteCollection": {
    input: CollectionCommandInput;
    output: CollectionDeleteCommandResult;
  };
  "library.deleteTag": {
    input: TagCommandInput;
    output: TagDeleteCommandResult;
  };
  "library.mergeWorks": {
    input: MergeWorksCommandInput;
    output: MergeWorksCommandResult;
  };
  "library.moveCollection": {
    input: MoveCollectionCommandInput;
    output: WorkMutationCountResult;
  };
  "library.renameCollection": {
    input: RenameCollectionCommandInput;
    output: WorkMutationCountResult;
  };
  "library.renameTag": {
    input: RenameTagCommandInput;
    output: TagMutationResult;
  };
  "library.restoreCollection": {
    input: RestoreCollectionCommandInput;
    output: CollectionRestoreCommandResult;
  };
  "library.restoreTag": {
    input: RestoreTagCommandInput;
    output: TagMutationResult;
  };
  "library.restoreWorks": {
    input: WorkIdsCommandInput;
    output: WorkMutationCountResult;
  };
  "library.setTagColor": {
    input: SetTagColorCommandInput;
    output: WorkMutationCountResult;
  };
  "library.setWorksCollection": {
    input: SetWorksCollectionCommandInput;
    output: WorkMutationCountResult;
  };
  "library.setWorkReadingStatus": {
    input: SetWorkReadingStatusCommandInput;
    output: WorkMutationCountResult;
  };
  "library.setWorkStarred": {
    input: SetWorkStarredCommandInput;
    output: WorkMutationCountResult;
  };
  "library.trashWorks": {
    input: WorkIdsCommandInput;
    output: WorkMutationCountResult;
  };
  "library.purgeDeletedWorks": {
    input: PurgeDeletedWorksCommandInput;
    output: PurgeDeletedWorksCommandResult;
  };
  "library.importBackup": {
    input: ImportLibraryBackupCommandInput;
    output: LibraryBackupImportSummary;
  };
  "sync.applyRemoteSegment": {
    input: ApplyRemoteSyncSegmentCommandInput;
    output: ApplyRemoteSegmentResult;
  };
}

export type DataCommandName = keyof DataCommandMap;
export type DataCommandInput<K extends DataCommandName> = DataCommandMap[K]["input"];
export type DataCommandOutput<K extends DataCommandName> = DataCommandMap[K]["output"];

export type DataCommandRequest = {
  [K in DataCommandName]: {
    input: DataCommandInput<K>;
    name: K;
  };
}[DataCommandName];
