import type { MergeWorksResult, ReadingStatus } from "@aurascholar/db/repos/works";
import type { DiscoverySource, ResearchProject } from "@aurascholar/core";
import type {
  SentinelCheckUpdate,
  SentinelCreateInput,
  SentinelCreateResult,
} from "@aurascholar/db/repos/sentinel";
import type { ApplyRemoteSegmentCommand, ApplyRemoteSegmentResult } from "@aurascholar/sync";
import type { LibraryBackupImportSummary } from "../src/shared/library-backup";
import type { EvidenceDataCommandMap } from "./evidence-command-contract";
import type * as KnowledgeContract from "./knowledge-command-contract";

export type {
  DocumentRevisionCommandInput,
  EvidenceCommandInput,
  EvidenceDataCommandMap,
  EvidenceProjectCommandInput,
  EvidenceTombstoneCommandInput,
  ListEvidenceCommandInput,
  ResolveDocumentRevisionCommandInput,
  ResolvedDocumentRevisionDto,
  SearchEvidenceCommandInput,
  SaveTextEvidenceCommandInput,
  SaveTextEvidenceCommandResult,
} from "./evidence-command-contract";

export type * from "./knowledge-command-contract";

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

export interface CreateSavedSearchCommandInput extends LibraryScopedCommandInput {
  query: string;
  sources: DiscoverySource[] | null;
}

export interface CreateSavedSearchCommandResult {
  created: boolean;
  id: string;
}

export interface SavedSearchCommandInput extends LibraryScopedCommandInput {
  savedSearchId: string;
}

export interface SavedSearchMutationResult {
  updated: number;
}

export interface RecordSavedSearchRunCommandInput extends SavedSearchCommandInput {
  expectedUpdatedAt: number;
  nextRunAt: number;
  observedIds: string[];
}

export interface RecordSavedSearchRunCommandResult {
  committed: boolean;
  freshCount: number;
  updatedAt: number | null;
}

export interface RecordSavedSearchErrorCommandInput extends SavedSearchCommandInput {
  error: string;
  expectedUpdatedAt: number;
  nextRunAt: number;
}

export interface RecordSavedSearchErrorCommandResult {
  committed: boolean;
  updatedAt: number | null;
}

export interface CreateOrRestoreSentinelCommandInput
  extends LibraryScopedCommandInput, SentinelCreateInput {}

export interface SentinelTaskCommandInput extends LibraryScopedCommandInput {
  taskId: string;
}

export interface SetSentinelTaskStatusCommandInput extends SentinelTaskCommandInput {
  status: "active" | "paused" | "done";
}

export interface LinkSentinelWorkCommandInput extends SentinelTaskCommandInput {
  expectedUpdatedAt: number;
  workId: string;
}

export interface SentinelCommitCommandResult {
  committed: boolean;
}

export interface RecordSentinelCheckCommandInput extends SentinelTaskCommandInput {
  update: Omit<SentinelCheckUpdate, "expectedUpdatedAt"> & {
    expectedUpdatedAt: number;
  };
}

export interface RecordSentinelCheckCommandResult {
  committed: boolean;
  eventIds: string[];
  updatedAt: number | null;
}

export interface ResearchProjectCommandInput extends LibraryScopedCommandInput {
  projectId: string;
}

export interface CreateResearchProjectCommandInput extends LibraryScopedCommandInput {
  description?: string | null;
  name: string;
}

export interface RenameResearchProjectCommandInput extends ResearchProjectCommandInput {
  expectedUpdatedAt: number;
  name: string;
}

export interface ResearchProjectWorksCommandInput extends ResearchProjectCommandInput {
  workIds: string[];
}

export interface ListResearchProjectSourcesCommandInput extends ResearchProjectCommandInput {
  limit?: number;
  offset?: number;
}

export interface SearchResearchProjectLibraryWorksCommandInput extends ResearchProjectCommandInput {
  limit?: number;
  query: string;
}

export interface ResearchProjectSummary extends Omit<ResearchProject, "deletedAt" | "description"> {
  canvasCount: number;
  deletedAt: number | null;
  description: string | null;
  sourceCount: number;
}

export interface ResearchProjectWorkSummary {
  annotationCount: number;
  authorNames: string[];
  doi: string | null;
  id: string;
  inProject: boolean;
  pdfCount: number;
  readingStatus: ReadingStatus;
  starred: boolean;
  tagNames: string[];
  title: string;
  updatedAt: number;
  venueName: string | null;
  year: number | null;
}

export interface ResearchProjectMutationResult {
  updated: number;
}

export type ResearchProjectScopeCommandInput = Record<string, never>;

export interface DataCommandMap extends EvidenceDataCommandMap {
  "knowledge.buildSemanticIndex": {
    input: LibraryScopedCommandInput;
    output: KnowledgeContract.BuildKnowledgeSemanticIndexResult;
  };
  "knowledge.getContentStats": {
    input: LibraryScopedCommandInput;
    output: { stats: KnowledgeContract.KnowledgeContentIndexStats };
  };
  "knowledge.getSemanticIndexStatus": {
    input: LibraryScopedCommandInput;
    output: { status: KnowledgeContract.KnowledgeSemanticIndexStatus };
  };
  "knowledge.searchContent": {
    input: KnowledgeContract.SearchKnowledgeContentCommandInput;
    output: {
      results: KnowledgeContract.KnowledgeContentSearchResult[];
      retrieval: KnowledgeContract.KnowledgeContentSearchRetrieval;
    };
  };
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
  "project.addWorks": {
    input: ResearchProjectWorksCommandInput;
    output: ResearchProjectMutationResult;
  };
  "project.create": {
    input: CreateResearchProjectCommandInput;
    output: { project: ResearchProjectSummary };
  };
  "project.get": {
    input: ResearchProjectCommandInput;
    output: { project: ResearchProjectSummary | null };
  };
  "project.getScope": {
    input: ResearchProjectScopeCommandInput;
    output: { libraryId: string };
  };
  "project.list": {
    input: LibraryScopedCommandInput;
    output: { projects: ResearchProjectSummary[] };
  };
  "project.listSources": {
    input: ListResearchProjectSourcesCommandInput;
    output: { sources: ResearchProjectWorkSummary[]; total: number };
  };
  "project.removeWorks": {
    input: ResearchProjectWorksCommandInput;
    output: ResearchProjectMutationResult;
  };
  "project.rename": {
    input: RenameResearchProjectCommandInput;
    output: { project: ResearchProjectSummary };
  };
  "project.searchLibraryWorks": {
    input: SearchResearchProjectLibraryWorksCommandInput;
    output: { works: ResearchProjectWorkSummary[] };
  };
  "savedSearch.clearNew": {
    input: SavedSearchCommandInput;
    output: SavedSearchMutationResult;
  };
  "savedSearch.create": {
    input: CreateSavedSearchCommandInput;
    output: CreateSavedSearchCommandResult;
  };
  "savedSearch.delete": {
    input: SavedSearchCommandInput;
    output: SavedSearchMutationResult;
  };
  "savedSearch.recordError": {
    input: RecordSavedSearchErrorCommandInput;
    output: RecordSavedSearchErrorCommandResult;
  };
  "savedSearch.recordRun": {
    input: RecordSavedSearchRunCommandInput;
    output: RecordSavedSearchRunCommandResult;
  };
  "savedSearch.restore": {
    input: SavedSearchCommandInput;
    output: SavedSearchMutationResult;
  };
  "sentinel.createOrRestore": {
    input: CreateOrRestoreSentinelCommandInput;
    output: SentinelCreateResult;
  };
  "sentinel.delete": {
    input: SentinelTaskCommandInput;
    output: WorkMutationCountResult;
  };
  "sentinel.linkWork": {
    input: LinkSentinelWorkCommandInput;
    output: SentinelCommitCommandResult;
  };
  "sentinel.recordCheck": {
    input: RecordSentinelCheckCommandInput;
    output: RecordSentinelCheckCommandResult;
  };
  "sentinel.restore": {
    input: SentinelTaskCommandInput;
    output: WorkMutationCountResult;
  };
  "sentinel.setStatus": {
    input: SetSentinelTaskStatusCommandInput;
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
