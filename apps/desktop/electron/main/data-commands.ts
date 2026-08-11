import type { Database } from "@aurascholar/db";
import { WorksRepo } from "@aurascholar/db/repos/works";
import { CH } from "../shared";
import type {
  DataCommandName,
  DataCommandOutput,
  MergeWorksCommandInput,
  PurgeDeletedWorksCommandInput,
  SetWorkReadingStatusCommandInput,
  SetWorkStarredCommandInput,
  WorkIdsCommandInput,
} from "../data-command-contract";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { parseDataCommandEnvelope } from "./data-command-envelope";
import { handle } from "./ipc";
import { getStableDeviceId } from "./platform";
import { executeAiCommand } from "./ai-commands";
import { executeAnnotationRecoveryCommand } from "./annotation-recovery-commands";
import { executeCanvasPageCommand } from "./canvas-page-commands";
import { executeCanvasWorkspaceCommand } from "./canvas-workspace-commands";
import { executeCitationGraphCommand } from "./citation-graph-commands";
import { executeDiscoveryLibraryStatusCommand } from "./discovery-library-status-commands";
import { executeDiscoverySiteCommand } from "./discovery-site-commands";
import { executeLibraryCollectionCommand } from "./library-collection-commands";
import { executeLibraryCslCommand } from "./library-csl-commands";
import { executeLibraryBackupCommand } from "./library-backup-commands";
import { executeLibraryIngestDedupCommand } from "./library-ingest-dedup-commands";
import { executeLibraryIngestCommand } from "./library-ingest-commands";
import { executeLibraryListCommand } from "./library-list-commands";
import { executeLibraryOaCommand } from "./library-oa-commands";
import { executeLibraryPageCommand } from "./library-page-commands";
import { executeLibraryPdfStagingCommand } from "./library-pdf-staging-commands";
import {
  claimLibraryStagedPdf,
  releaseLibraryStagedPdf,
  stageLibraryPdf,
} from "./library-pdf-staging";
import { verifyStagedPdf } from "./staged-pdf-verification";
import { executeLibraryShellCommand } from "./library-shell-commands";
import { executeLibraryTagCommand } from "./library-tag-commands";
import { executeReferenceImportCommand } from "./reference-import-commands";
import { executeReaderCommand } from "./reader-commands";
import { executeResearchProjectCommand } from "./research-project-commands";
import { executeEvidenceCommand } from "./evidence-commands";
import { executeEvidenceInboxCommand } from "./evidence-inbox-commands";
import { executeKnowledgeCommand } from "./knowledge-commands";
import { localSemanticIndexService } from "./local-semantic-index-runtime";
import { localSemanticSearchService } from "./local-semantic-search-runtime";
import { executeSavedSearchCommand } from "./saved-search-commands";
import { executeScholarlyCommand } from "./scholarly-commands";
import { executeSentinelCommand } from "./sentinel-commands";
import { executeSentinelReadCommand } from "./sentinel-read-commands";
import { executeSentinelRunCommand } from "./sentinel-run-commands";
import { executeSnippetCommand } from "./snippet-commands";
import { executeSyncCommand } from "./sync-commands";
import { executeTranslationCacheCommand } from "./translation-cache-commands";
import { executeTranslationProviderCommand } from "./translation-provider-commands";
import { executeWorkMetadataCommand } from "./work-metadata-commands";
import {
  assertActiveLocalLibrary,
  isRecord,
  requireRecordId,
  type DataCommandDependencies,
} from "./data-command-runtime";

const MAX_MERGE_DUPLICATE_IDS = 500;
const MAX_WORK_IDS_PER_COMMAND = 500;
export type { DataCommandDependencies } from "./data-command-runtime";
const defaultDependencies: DataCommandDependencies = {
  inspect: (operation) => withMainDatabase(operation),
  execute: (_commandName, operation) => withMainDatabase(operation),
  getDeviceId: getStableDeviceId,
  transaction: withMainDatabaseTransaction,
  claimStagedPdf: claimLibraryStagedPdf,
  verifyStagedPdf,
  releaseStagedPdf: releaseLibraryStagedPdf,
  stagePdf: stageLibraryPdf,
};

export function registerDataCommandHandlers(): void {
  handle(CH.dataCommand, (_event, request: unknown) => executeDataCommand(request));
}

export async function executeDataCommand(
  request: unknown,
  dependencies: DataCommandDependencies = defaultDependencies,
): Promise<DataCommandOutput<DataCommandName>> {
  const envelope = parseDataCommandEnvelope(request);
  switch (envelope.name) {
    case "ai.adoptLegacySettings":
    case "ai.cancelRun":
    case "ai.commitFlashcardGeneration":
    case "ai.generateFlashcards":
    case "ai.getFlashcardTarget":
    case "ai.getSettings":
    case "ai.recordFlashcardFailure":
    case "ai.saveSettings":
    case "ai.synthesizeCanvas":
    case "ai.testProvider":
      return executeAiCommand(envelope, {
        execute(commandName, operation) {
          if (!dependencies.execute) {
            throw new Error("Main-process AI command execution is unavailable");
          }
          return dependencies.execute(commandName, operation);
        },
      });
    case "canvas.listWorkspaces":
    case "canvas.loadWorkspace":
    case "canvas.createWorkspace":
    case "canvas.renameWorkspace":
    case "canvas.deleteWorkspace":
    case "canvas.saveWorkspace":
      return executeCanvasWorkspaceCommand(envelope, dependencies);
    case "canvas.getActiveWork":
    case "canvas.getAnnotationIngressSource":
    case "canvas.getCitationRelations":
    case "canvas.persistCitationRelations":
      return executeCanvasPageCommand(envelope, dependencies);
    case "citationGraph.getActiveLibraryDois":
    case "citationGraph.getCached":
    case "citationGraph.putCached":
      return executeCitationGraphCommand(envelope, dependencies);
    case "discovery.getLibraryStatus":
      return executeDiscoveryLibraryStatusCommand(envelope.input, (operation) => {
        if (!dependencies.execute) {
          throw new Error("Main-process Discovery Library status query execution is unavailable");
        }
        return dependencies.execute(envelope.name, operation);
      });
    case "discovery.searchOpenSources":
    case "scholar.enrichByDoi":
    case "citationGraph.build":
    case "library.resolveClue":
    case "scholarly.cancelRun":
      return executeScholarlyCommand(envelope);
    case "discoverySite.addSite":
    case "discoverySite.getSettings":
    case "discoverySite.listSites":
    case "discoverySite.removeSite":
    case "discoverySite.restoreSite":
    case "discoverySite.setSettings":
    case "discoverySite.setSiteHidden":
    case "discoverySite.setSiteProxy":
      return executeDiscoverySiteCommand(envelope, dependencies);
    case "document.resolveAttachmentRevision":
    case "document.resolveRevision":
    case "evidence.get":
    case "evidence.list":
    case "evidence.saveText":
      return executeEvidenceCommand(envelope, dependencies);
    case "evidence.search":
    case "evidence.addToProject":
    case "evidence.removeFromProject":
    case "evidence.softDelete":
    case "evidence.restore":
      return executeEvidenceInboxCommand(envelope, dependencies);
    case "knowledge.buildSemanticIndex":
    case "knowledge.getContentStats":
    case "knowledge.getSemanticIndexStatus":
    case "knowledge.searchContent":
      return executeKnowledgeCommand(envelope, dependencies, {
        semanticIndex: localSemanticIndexService,
        semanticSearch: localSemanticSearchService,
      });
    case "library.addTagToWorks":
    case "library.createTag":
    case "library.deleteTag":
    case "library.listTags":
    case "library.renameTag":
    case "library.restoreTag":
    case "library.setTagColor":
      return executeLibraryTagCommand(envelope, dependencies);
    case "library.getPage":
    case "library.getWorkRuntimeMeta":
      return executeLibraryPageCommand(envelope, dependencies);
    case "library.listWorks":
    case "library.searchWorksByMetadata":
      return executeLibraryListCommand(envelope, dependencies);
    case "library.getCslItems":
      return executeLibraryCslCommand(envelope, dependencies);
    case "library.findIngestDedup":
      return executeLibraryIngestDedupCommand(envelope, dependencies);
    case "library.finalizeIngest":
      return executeLibraryIngestCommand(envelope, dependencies);
    case "library.ensureOaPdfAttachment":
      return executeLibraryOaCommand(envelope);
    case "library.releaseStagedPdf":
    case "library.stagePdf":
      return executeLibraryPdfStagingCommand(envelope, dependencies);
    case "library.getWorkMetadata":
    case "library.updateWorkMetadata":
      return executeWorkMetadataCommand(envelope, dependencies);
    case "library.getScope":
    case "library.getShellStats":
      return executeLibraryShellCommand(envelope, dependencies);
    case "library.importReferences":
      return executeReferenceImportCommand(envelope, dependencies);
    case "library.restoreAnnotationsForAttachment":
      return executeAnnotationRecoveryCommand(envelope, dependencies);
    case "reader.createAnnotation":
    case "reader.deleteAnnotation":
    case "reader.getAttachment":
    case "reader.getWorkPdfCandidates":
    case "reader.listAnnotations":
    case "reader.markWorkReadingStarted":
    case "reader.restoreAnnotation":
    case "reader.updateAnnotationContent":
      return executeReaderCommand(envelope, dependencies);
    case "library.createCollection":
    case "library.deleteCollection":
    case "library.moveCollection":
    case "library.renameCollection":
    case "library.restoreCollection":
    case "library.setWorksCollection":
      return executeLibraryCollectionCommand(envelope, dependencies);
    case "project.addWorks":
    case "project.create":
    case "project.get":
    case "project.getScope":
    case "project.list":
    case "project.listSources":
    case "project.removeWorks":
    case "project.rename":
    case "project.searchLibraryWorks":
      return executeResearchProjectCommand(envelope, dependencies);
    case "savedSearch.clearNew":
    case "savedSearch.create":
    case "savedSearch.delete":
    case "savedSearch.get":
    case "savedSearch.getScope":
    case "savedSearch.list":
    case "savedSearch.listDue":
    case "savedSearch.recordError":
    case "savedSearch.recordRun":
    case "savedSearch.restore":
      return executeSavedSearchCommand(envelope, dependencies);
    case "sentinel.createOrRestore":
    case "sentinel.delete":
    case "sentinel.linkWork":
    case "sentinel.recordCheck":
    case "sentinel.restore":
    case "sentinel.setStatus":
      return executeSentinelCommand(envelope, dependencies);
    case "sentinel.getDuePollSnapshot":
    case "sentinel.getPageSnapshot":
    case "sentinel.getTaskPollSnapshot":
      return executeSentinelReadCommand(envelope, dependencies);
    case "sentinel.cancelRun":
    case "sentinel.runDuePolls":
    case "sentinel.runTaskNow":
      return executeSentinelRunCommand(envelope);
    case "snippet.create":
    case "snippet.delete":
    case "snippet.listAll":
    case "snippet.restore":
    case "snippet.updateNote":
      return executeSnippetCommand(envelope, dependencies);
    case "translationCache.clear":
    case "translationCache.get":
    case "translationCache.put":
      return executeTranslationCacheCommand(envelope, dependencies);
    case "translation.adoptLegacySettings":
    case "translation.cancel":
    case "translation.getSettings":
    case "translation.saveSettings":
    case "translation.translate":
      return executeTranslationProviderCommand(envelope);
    case "library.mergeWorks": {
      const input = parseMergeWorksInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveMergeWorksBelongToLibrary(
          database,
          input.libraryId,
          input.primaryId,
          input.duplicateIds,
        );
        const result = await new WorksRepo(database, input.libraryId).mergeInto(
          input.primaryId,
          input.duplicateIds,
        );
        if (result.primaryId !== input.primaryId || result.merged !== input.duplicateIds.length) {
          throw new Error("Merge did not retire every requested duplicate work");
        }
        return result;
      });
    }
    case "library.restoreWorks": {
      const input = parseWorkIdsCommandInput(envelope.input, envelope.name);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertDeletedWorksBelongToLibrary(database, input.libraryId, input.workIds);
        const updated = await new WorksRepo(database, input.libraryId).restoreMany(input.workIds);
        if (updated !== input.workIds.length) {
          throw new Error("Restore did not update every requested work");
        }
        return { updated };
      });
    }
    case "library.setWorkReadingStatus": {
      const input = parseSetWorkReadingStatusInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveWorksBelongToLibrary(database, input.libraryId, [input.workId]);
        await new WorksRepo(database, input.libraryId).setReadingStatus(input.workId, input.status);
        return { updated: 1 };
      });
    }
    case "library.setWorkStarred": {
      const input = parseSetWorkStarredInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveWorksBelongToLibrary(database, input.libraryId, [input.workId]);
        await new WorksRepo(database, input.libraryId).setStarred(input.workId, input.starred);
        return { updated: 1 };
      });
    }
    case "library.trashWorks": {
      const input = parseWorkIdsCommandInput(envelope.input, envelope.name);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertActiveWorksBelongToLibrary(database, input.libraryId, input.workIds);
        const updated = await new WorksRepo(database, input.libraryId).softDeleteMany(
          input.workIds,
        );
        if (updated !== input.workIds.length) {
          throw new Error("Trash did not update every requested work");
        }
        return { updated };
      });
    }
    case "library.purgeDeletedWorks": {
      const input = parsePurgeDeletedWorksInput(envelope.input);
      return dependencies.transaction(envelope.name, async (database) => {
        await assertActiveLocalLibrary(database, input.libraryId);
        await assertDeletedWorksBelongToLibrary(database, input.libraryId, input.workIds);
        const purged = await new WorksRepo(database, input.libraryId).purgeDeletedMany(
          input.workIds,
        );
        if (purged !== input.workIds.length) {
          throw new Error("Permanent deletion did not remove every requested work");
        }
        return { purged };
      });
    }
    case "library.exportBackup":
    case "library.importBackup":
      return executeLibraryBackupCommand(envelope, dependencies);
    case "sync.adoptLegacySettings":
    case "sync.getSettings":
    case "sync.run":
    case "sync.saveSettings":
      return executeSyncCommand(envelope);
  }
}

function parseMergeWorksInput(value: unknown): MergeWorksCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.mergeWorks input");
  const libraryId = requireRecordId(value.libraryId, "Library id");
  const primaryId = requireRecordId(value.primaryId, "Primary work id");
  if (!Array.isArray(value.duplicateIds) || value.duplicateIds.length === 0) {
    throw new Error("At least one duplicate work id is required");
  }
  if (value.duplicateIds.length > MAX_MERGE_DUPLICATE_IDS) {
    throw new Error(`Merging is limited to ${MAX_MERGE_DUPLICATE_IDS} duplicate works at a time`);
  }
  const duplicateIds = Array.from(value.duplicateIds, (workId, index) =>
    requireRecordId(workId, `Duplicate work id at index ${index}`),
  );
  if (new Set(duplicateIds).size !== duplicateIds.length) {
    throw new Error("Duplicate work ids must be unique");
  }
  if (duplicateIds.includes(primaryId)) {
    throw new Error("Primary work cannot also be a duplicate");
  }
  return { libraryId, primaryId, duplicateIds };
}

function parsePurgeDeletedWorksInput(value: unknown): PurgeDeletedWorksCommandInput {
  return parseWorkIdsCommandInput(value, "library.purgeDeletedWorks");
}

function parseWorkIdsCommandInput(
  value: unknown,
  commandName: "library.purgeDeletedWorks" | "library.restoreWorks" | "library.trashWorks",
): WorkIdsCommandInput {
  if (!isRecord(value)) throw new Error(`Invalid ${commandName} input`);
  const libraryId = requireRecordId(value.libraryId, "Library id");
  if (!Array.isArray(value.workIds) || value.workIds.length === 0) {
    throw new Error("At least one work id is required");
  }
  if (value.workIds.length > MAX_WORK_IDS_PER_COMMAND) {
    throw new Error(`Library work updates are limited to ${MAX_WORK_IDS_PER_COMMAND} at a time`);
  }
  const workIds = Array.from(value.workIds, (workId, index) =>
    requireRecordId(workId, `Work id at index ${index}`),
  );
  if (new Set(workIds).size !== workIds.length) {
    throw new Error("Work ids must be unique");
  }
  return { libraryId, workIds };
}

function parseSetWorkReadingStatusInput(value: unknown): SetWorkReadingStatusCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.setWorkReadingStatus input");
  const libraryId = requireRecordId(value.libraryId, "Library id");
  const workId = requireRecordId(value.workId, "Work id");
  if (value.status !== "unread" && value.status !== "reading" && value.status !== "read") {
    throw new Error("Reading status is invalid");
  }
  return { libraryId, status: value.status, workId };
}

function parseSetWorkStarredInput(value: unknown): SetWorkStarredCommandInput {
  if (!isRecord(value)) throw new Error("Invalid library.setWorkStarred input");
  const libraryId = requireRecordId(value.libraryId, "Library id");
  const workId = requireRecordId(value.workId, "Work id");
  if (typeof value.starred !== "boolean") {
    throw new Error("Starred state must be a boolean");
  }
  return { libraryId, starred: value.starred, workId };
}

async function assertDeletedWorksBelongToLibrary(
  database: Database,
  libraryId: string,
  workIds: string[],
): Promise<void> {
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NOT NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (rows.length !== workIds.length) {
    throw new Error("Every work must belong to the active Library recycle bin");
  }
}

async function assertActiveWorksBelongToLibrary(
  database: Database,
  libraryId: string,
  workIds: string[],
): Promise<void> {
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (rows.length !== workIds.length) {
    throw new Error("Every work must be active and belong to the active Library");
  }
}

async function assertActiveMergeWorksBelongToLibrary(
  database: Database,
  libraryId: string,
  primaryId: string,
  duplicateIds: string[],
): Promise<void> {
  const workIds = [primaryId, ...duplicateIds];
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (rows.length !== workIds.length) {
    throw new Error("Every merge work must be active and belong to the active Library");
  }
}
