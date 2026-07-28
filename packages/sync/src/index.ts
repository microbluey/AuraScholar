export type { SyncProvider, RemoteObject } from "./provider.js";
export { WebDavProvider } from "./webdav.js";
export type { WebDavOptions } from "./webdav.js";
export { LibraryScopedSyncProvider } from "./scoped-provider.js";
export { HlcClock, hlcToString, hlcFromString, hlcCompare } from "./hlc.js";
export type { Hlc } from "./hlc.js";
export { applyRemoteSegment, SyncEngine } from "./engine.js";
export type {
  ApplyRemoteSegmentCommand,
  ApplyRemoteSegmentOptions,
  ApplyRemoteSegmentResult,
  ConflictRecord,
  MarkPushedOptions,
  RemoteSegmentMergeStorage,
  SyncResult,
  SyncStorage,
} from "./engine.js";
export { MemorySyncProvider } from "./memory-provider.js";
export { MemorySyncStorage } from "./memory-storage.js";
export {
  columnsForSyncedTable,
  pickKnownTableRecord,
  pickKnownTableStringRecord,
} from "./table-guard.js";
export type { SyncedTableColumns } from "./table-guard.js";
export { safeSnapshotWatermark } from "./watermark.js";
export { segmentPath, parseSegmentPath, encodeSegment, decodeSegment } from "./types.js";
export type { ChangeEntry, JournalSegment } from "./types.js";
export {
  DEFAULT_SPATIAL_CANVAS_WORKSPACE_ID,
  SPATIAL_CANVAS_BACKUP_TABLES,
  assertSpatialCanvasBackupOrder,
  assertSpatialCanvasBackupNodeGroups,
  flattenSpatialCanvasBackupNodeGroups,
  remapSpatialCanvasBackupRow,
} from "./canvas-backup.js";
export type {
  SpatialCanvasBackupIdMaps,
  SpatialCanvasBackupRemapResult,
  SpatialCanvasBackupTable,
} from "./canvas-backup.js";
