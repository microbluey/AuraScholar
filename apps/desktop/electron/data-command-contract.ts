import type { ApplyRemoteSegmentCommand, ApplyRemoteSegmentResult } from "@aurascholar/sync";
import type { LibraryBackupImportSummary } from "../src/shared/library-backup";

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
