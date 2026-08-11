import type { SyncResult } from "@aurascholar/sync";
import type { LibraryBackupImportSummary } from "../../services/sync";
import { describeSafeError } from "../../services/sensitive-text";
import type { SettingsUrlValidation, SyncSettingsSnapshot } from "./settings-contracts";

export function describeSyncRunError(value: unknown): string {
  const message = describeSafeError(value);
  if (/local sync log|local changes for|Invalid local sync log entry/i.test(message)) {
    return "本机同步日志可能不完整，或包含当前版本还不支持的数据结构。本机数据未被覆盖；请先升级 AuraScholar，确认本机数据库来自兼容版本后再同步。";
  }
  if (/Unsupported sync (table|column)/i.test(message)) {
    return "远端同步目录包含当前版本还不支持的数据结构。请先升级 AuraScholar，或确认所有设备使用同一版本后再同步。";
  }
  if (
    /Invalid sync segment|malformed|non-monotonic|bad sequence range|sequence range does not match/i.test(
      message,
    )
  ) {
    return "远端同步日志可能已损坏或写入不完整。本机数据未被覆盖；请检查 WebDAV 目录中的 journal 文件，修复或移走异常文件后再同步。";
  }
  const webDavStatus = message.match(/WebDAV .* failed: (\d{3})|WebDAV unreachable: (\d{3})/i);
  if (webDavStatus) {
    const status = webDavStatus[1] ?? webDavStatus[2] ?? "未知";
    return describeWebDavStatus(status);
  }
  return message;
}

export function formatSyncSuccessStatus(result: SyncResult): string {
  const changed = result.pushedEntries + result.pulledEntries + result.appliedEntries;
  if (changed === 0 && result.conflicts === 0) {
    return "同步完成：本机与远端已是最新。";
  }
  const summary = `同步完成：推送 ${result.pushedEntries} 条，拉取 ${result.pulledEntries} 条，应用 ${result.appliedEntries} 条`;
  if (result.conflicts > 0) {
    return `${summary}，${result.conflicts} 个冲突已记录，可稍后在同步冲突记录中检查。`;
  }
  return summary;
}

export function formatBackupImportSuccessStatus(summary: LibraryBackupImportSummary): string {
  const lead =
    summary.imported > 0
      ? `备份导入完成：新增 ${summary.imported} 条`
      : "备份导入完成：没有新增记录，当前库可能已包含这些数据";
  const skipped = summary.skipped > 0 ? `，跳过 ${summary.skipped} 条` : "";
  return (
    `${lead}${skipped}。` +
    (summary.redirectedRows > 0 ? ` 已合并 ${summary.redirectedRows} 条关联数据到已有记录。` : "") +
    (summary.deactivatedAttachments > 0
      ? ` ${summary.deactivatedAttachments} 个附件记录已标记为待重新挂载。`
      : "") +
    (summary.skippedRuntimeRows > 0
      ? ` ${summary.skippedRuntimeRows} 条旧设备未完成的 AI 任务未恢复，可在新设备重新生成。`
      : "") +
    (summary.ignoredTables.length > 0
      ? ` 已忽略 ${formatBackupIgnoredTables(summary.ignoredTables)}。`
      : "")
  );
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function formatBackupIgnoredTables(ignoredTables: string[]): string {
  const names = Array.from(new Set(ignoredTables.map((name) => name.trim()).filter(Boolean)));
  if (names.length === 0) return "0 个不支持或运行态数据表";
  const listed = names
    .slice(0, 3)
    .map((name) => (name.length > 40 ? `${name.slice(0, 37)}...` : name))
    .join("、");
  return `${names.length} 个不支持或运行态数据表（${listed}${names.length > 3 ? " 等" : ""}）`;
}

export function makeSyncSettingsSnapshot(
  baseUrl: string,
  username: string,
  password: string,
  hasPassword: boolean = Boolean(password.trim()),
): SyncSettingsSnapshot {
  return {
    baseUrl: baseUrl.trim(),
    hasPassword,
    username: username.trim(),
    password,
  };
}

export function normalizeWebDavBaseUrl(value: string): SettingsUrlValidation {
  const raw = value.trim();
  if (!raw) return { message: "请填写 WebDAV 地址。", ok: false };
  const url = newURL(raw);
  if (!url) {
    return {
      message: "WebDAV 地址格式不正确，请使用完整的 http:// 或 https:// 地址。",
      ok: false,
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      message: "WebDAV 地址仅支持 http:// 或 https://。",
      ok: false,
    };
  }
  if (url.username || url.password) {
    return {
      message: "WebDAV 地址不要包含用户名或密码，请填写在下方账号字段中。",
      ok: false,
    };
  }
  if (url.search || url.hash) {
    return {
      message: "WebDAV 地址请填写目录地址，不要包含查询参数或 # 片段。",
      ok: false,
    };
  }
  return { ok: true, value: url.toString().replace(/\/+$/, "") };
}

export function sameSyncSettings(a: SyncSettingsSnapshot, b: SyncSettingsSnapshot): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    a.username === b.username &&
    a.password === b.password &&
    a.hasPassword === b.hasPassword
  );
}

function describeWebDavStatus(status: string): string {
  switch (status) {
    case "401":
    case "403":
      return `WebDAV 服务返回 ${status}。认证失败或没有目录权限，请检查账号、应用密码和该目录的读写权限。`;
    case "404":
      return "WebDAV 服务返回 404。同步目录不存在，请确认地址是可写目录，必要时先在云盘中创建 AuraScholar 文件夹。";
    case "409":
      return "WebDAV 服务返回 409。父目录不存在或服务器拒绝创建目录，请确认同步地址指向已存在的可写目录。";
    case "423":
      return "WebDAV 服务返回 423。同步目录当前被锁定，请稍后重试，或在云盘/同步工具中解除目录锁定。";
    case "507":
      return "WebDAV 服务返回 507。远端空间不足，无法保存同步日志；请清理云盘空间后再同步。";
    default:
      return `WebDAV 服务返回 ${status}。请检查地址、账号、应用密码和该目录的读写权限。`;
  }
}

function newURL(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
