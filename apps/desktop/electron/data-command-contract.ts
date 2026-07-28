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
  "library.mergeWorks": {
    input: MergeWorksCommandInput;
    output: MergeWorksCommandResult;
  };
  "library.restoreWorks": {
    input: WorkIdsCommandInput;
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
