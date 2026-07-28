import { LIBRARY_BACKUP_VERSION } from "../../shared/library-backup";
import { isStorageRecord, readLocalStorageJson, tryWriteLocalStorageJson } from "../../storage";

export interface BackupSafetySnapshot {
  exportedAt: string;
  filename: string;
  size: number;
  version: number;
}

const BACKUP_SAFETY_KEY = "library-backup-safety";

export function readBackupSafetySnapshot(): BackupSafetySnapshot | null {
  const parsed = readLocalStorageJson<unknown>(BACKUP_SAFETY_KEY, null);
  if (!isStorageRecord(parsed)) return null;
  const exportedAt = typeof parsed.exportedAt === "string" ? parsed.exportedAt : "";
  const filename = typeof parsed.filename === "string" ? parsed.filename : "";
  const size = typeof parsed.size === "number" ? parsed.size : 0;
  const version =
    typeof parsed.version === "number" &&
    Number.isSafeInteger(parsed.version) &&
    parsed.version >= 1
      ? parsed.version
      : LIBRARY_BACKUP_VERSION;
  if (!exportedAt || !filename || !Number.isFinite(size) || size <= 0) return null;
  return { exportedAt, filename, size, version };
}

export function saveBackupSafetySnapshot(snapshot: BackupSafetySnapshot): boolean {
  return tryWriteLocalStorageJson(BACKUP_SAFETY_KEY, snapshot);
}
