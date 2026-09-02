import type { MergeWorksResult, ReadingStatus } from "@aurascholar/db/repos/works";
import type { ResearchProject } from "@aurascholar/core";
import type {
  SentinelCheckUpdate,
  SentinelCreateInput,
  SentinelCreateResult,
} from "@aurascholar/db/repos/sentinel";
import type { LibraryBackupImportSummary } from "../src/shared/library-backup";
import type { AiDataCommandMap } from "./ai-command-contract";
import type { AnnotationRecoveryDataCommandMap } from "./annotation-recovery-command-contract";
import type { CanvasDataCommandMap } from "./canvas-command-contract";
import type { CitationGraphDataCommandMap } from "./citation-graph-command-contract";
import type { DiscoveryLibraryStatusDataCommandMap } from "./discovery-library-status-command-contract";
import type { DiscoverySiteDataCommandMap } from "./discovery-site-command-contract";
import type { EvidenceDataCommandMap } from "./evidence-command-contract";
import type { EvidenceShelfDataCommandMap } from "./evidence-shelf-command-contract";
import type * as KnowledgeContract from "./knowledge-command-contract";
import type { LibraryIngestDataCommandMap } from "./library-ingest-command-contract";
import type { LibraryOaDataCommandMap } from "./library-oa-command-contract";
import type { LibraryReadDataCommandMap } from "./library-read-command-contract";
import type { ReferenceImportDataCommandMap } from "./reference-import-command-contract";
import type { ReaderDataCommandMap } from "./reader-command-contract";
import type { SavedSearchDataCommandMap } from "./saved-search-command-contract";
import type { SentinelReadDataCommandMap } from "./sentinel-read-command-contract";
import type { SentinelRunDataCommandMap } from "./sentinel-run-command-contract";
import type { SnippetDataCommandMap } from "./snippet-command-contract";
import type { ScholarlyDataCommandMap } from "./scholarly-command-contract";
import type { TranslationCacheDataCommandMap } from "./translation-cache-command-contract";
import type { TranslationProviderDataCommandMap } from "./translation-provider-command-contract";
import type { WorkMetadataDataCommandMap } from "./work-metadata-command-contract";
import type { SyncDataCommandMap } from "./sync-command-contract";

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
export type * from "./evidence-shelf-command-contract";

export type * from "./annotation-recovery-command-contract";
export type * from "./ai-command-contract";
export type * from "./canvas-command-contract";
export type * from "./citation-graph-command-contract";
export type * from "./discovery-library-status-command-contract";
export type * from "./discovery-site-command-contract";
export type * from "./knowledge-command-contract";
export type * from "./library-ingest-command-contract";
export type * from "./library-oa-command-contract";
export type * from "./library-page-command-contract";
export type * from "./library-read-command-contract";
export type * from "./reference-import-command-contract";
export type * from "./reader-command-contract";
export type * from "./saved-search-command-contract";
export type * from "./sentinel-read-command-contract";
export type * from "./sentinel-run-command-contract";
export type * from "./snippet-command-contract";
export type * from "./scholarly-command-contract";
export type * from "./sync-command-contract";
export type * from "./translation-cache-command-contract";
export type * from "./translation-provider-command-contract";
export type * from "./work-metadata-command-contract";

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
}

export type LibraryBackupExportCommandInput = Record<string, never>;

export interface LibraryBackupExportCommandResult {
  backupText: string;
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

export interface DataCommandMap
  extends
    AiDataCommandMap,
    AnnotationRecoveryDataCommandMap,
    CanvasDataCommandMap,
    CitationGraphDataCommandMap,
    DiscoveryLibraryStatusDataCommandMap,
    DiscoverySiteDataCommandMap,
    EvidenceDataCommandMap,
    EvidenceShelfDataCommandMap,
    LibraryIngestDataCommandMap,
    LibraryOaDataCommandMap,
    LibraryReadDataCommandMap,
    ReferenceImportDataCommandMap,
    ReaderDataCommandMap,
    SavedSearchDataCommandMap,
    ScholarlyDataCommandMap,
    SentinelReadDataCommandMap,
    SentinelRunDataCommandMap,
    SnippetDataCommandMap,
    SyncDataCommandMap,
    TranslationCacheDataCommandMap,
    TranslationProviderDataCommandMap,
    WorkMetadataDataCommandMap {
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
  "library.exportBackup": {
    input: LibraryBackupExportCommandInput;
    output: LibraryBackupExportCommandResult;
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
