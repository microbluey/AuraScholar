import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker, useLocation } from "react-router-dom";
import type { SyncResult } from "@aurascholar/sync";
import { TARGET_LANGS, type TranslateEngine } from "@aurascholar/translate";
import { Badge, Button, Card, Input, useTheme } from "@aurascholar/ui";
import {
  loadAiSettingsDraft,
  makeProvider,
  saveAiSettings,
  type AiProviderKind,
} from "../services/ai";
import {
  clearTranslationCache,
  loadTranslateConfig,
  saveTranslateConfig,
} from "../services/translate";
import {
  exportLibraryJson,
  importLibraryBackupJson,
  loadSyncSettings,
  previewLibraryBackupJson,
  runSync,
  saveSyncSettings,
  type LibraryBackupImportSummary,
} from "../services/sync";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { downloadBlob } from "../download";
import { isDesktopRuntime } from "../services/aura-platform";
import { describeSafeError } from "../services/sensitive-text";
import { isStorageRecord, readLocalStorageJson, tryWriteLocalStorageJson } from "../storage";

const AI_SETTINGS_UPDATED_EVENT = "aurascholar:ai-settings-updated";

const AI_PROVIDER_OPTIONS: Array<{
  id: AiProviderKind;
  label: string;
  badge: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
}> = [
  {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    badge: "BYOK",
    description: "DeepSeek、Moonshot、Ollama、本地 vLLM 或中转端点。",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    badge: "Claude",
    description: "直连 Anthropic Messages API，API 地址可留空使用官方端点。",
    defaultBaseUrl: "",
    defaultModel: "claude-sonnet-4-5",
  },
];

const DEFAULT_AI_PROVIDER_OPTION = AI_PROVIDER_OPTIONS[0]!;

interface AiSettingsSnapshot {
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface TranslateSettingsSnapshot {
  engine: TranslateEngine;
  targetLang: string;
  deeplKey: string;
  baiduAppid: string;
  baiduKey: string;
}

interface SyncSettingsSnapshot {
  baseUrl: string;
  username: string;
  password: string;
}

interface BackupSafetySnapshot {
  exportedAt: string;
  filename: string;
  size: number;
  version: 1;
}

interface BackupSafetyDisplay {
  detail: string;
  secondaryDetail: string;
  tone: "muted" | "ready" | "warning";
  value: string;
}

type SettingsUrlValidation = { ok: true; value: string } | { message: string; ok: false };

const DEFAULT_AI_SETTINGS: AiSettingsSnapshot = {
  kind: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  apiKey: "",
};

const DEFAULT_TRANSLATE_SETTINGS: TranslateSettingsSnapshot = {
  engine: "llm",
  targetLang: "zh",
  deeplKey: "",
  baiduAppid: "",
  baiduKey: "",
};

const DEFAULT_SYNC_SETTINGS: SyncSettingsSnapshot = {
  baseUrl: "",
  username: "",
  password: "",
};

const PREVIEW_AI_SETTINGS: AiSettingsSnapshot = {
  kind: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  apiKey: "preview-key-not-saved",
};

const PREVIEW_TRANSLATE_SETTINGS: TranslateSettingsSnapshot = {
  engine: "llm",
  targetLang: "zh",
  deeplKey: "",
  baiduAppid: "",
  baiduKey: "",
};

const PREVIEW_SYNC_SETTINGS: SyncSettingsSnapshot = {
  baseUrl: "https://dav.example.edu/remote.php/dav/files/aurascholar",
  username: "preview-researcher",
  password: "preview-password-not-saved",
};

const PREVIEW_BACKUP_SAFETY: BackupSafetySnapshot = {
  exportedAt: new Date(Date.UTC(2026, 6, 1, 10, 30, 0)).toISOString(),
  filename: "aurascholar-backup-preview.json",
  size: 388_240,
  version: 1,
};

const MIN_SETTINGS_BUSY_MS = 500;
const BACKUP_SAFETY_KEY = "library-backup-safety";
const BACKUP_FRESH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type SettingsTargetSection = "ai" | "translate" | "sync";
type SettingsSection = "appearance" | SettingsTargetSection;

type SettingsSmokeFailureKey =
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_SAVE__"
  | "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__";

function describeUnknownError(value: unknown): string {
  return describeSafeError(value);
}

function describeSyncRunError(value: unknown): string {
  const message = describeUnknownError(value);
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

function formatSyncSuccessStatus(result: SyncResult): string {
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

function formatBackupImportSuccessStatus(summary: LibraryBackupImportSummary): string {
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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatBackupIgnoredTables(ignoredTables: string[]): string {
  const names = Array.from(new Set(ignoredTables.map((name) => name.trim()).filter(Boolean)));
  if (names.length === 0) return "0 个不支持或运行态数据表";
  const listed = names
    .slice(0, 3)
    .map((name) => (name.length > 40 ? `${name.slice(0, 37)}...` : name))
    .join("、");
  return `${names.length} 个不支持或运行态数据表（${listed}${names.length > 3 ? " 等" : ""}）`;
}

function readBackupSafetySnapshot(): BackupSafetySnapshot | null {
  const parsed = readLocalStorageJson<unknown>(BACKUP_SAFETY_KEY, null);
  if (!isStorageRecord(parsed)) return null;
  const exportedAt = typeof parsed.exportedAt === "string" ? parsed.exportedAt : "";
  const filename = typeof parsed.filename === "string" ? parsed.filename : "";
  const size = typeof parsed.size === "number" ? parsed.size : 0;
  if (!exportedAt || !filename || !Number.isFinite(size) || size <= 0) return null;
  return { exportedAt, filename, size, version: 1 };
}

function saveBackupSafetySnapshot(snapshot: BackupSafetySnapshot): boolean {
  return tryWriteLocalStorageJson(BACKUP_SAFETY_KEY, snapshot);
}

function formatBackupTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间不可读";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function describeBackupSafety(snapshot: BackupSafetySnapshot | null): BackupSafetyDisplay {
  if (!snapshot) {
    return {
      detail: "尚未记录本机导出",
      secondaryDetail: "导出 JSON 后会自动更新",
      tone: "warning",
      value: "建议备份",
    };
  }

  const exportedAt = Date.parse(snapshot.exportedAt);
  if (!Number.isFinite(exportedAt)) {
    return {
      detail: "备份时间不可读",
      secondaryDetail: snapshot.filename,
      tone: "warning",
      value: "记录异常",
    };
  }

  const ageDays = Math.max(0, Math.floor((Date.now() - exportedAt) / DAY_MS));
  const fresh = ageDays <= BACKUP_FRESH_DAYS;
  return {
    detail:
      ageDays === 0
        ? `今天 ${formatBackupTimestamp(snapshot.exportedAt)}`
        : `${ageDays} 天前 ${formatBackupTimestamp(snapshot.exportedAt)}`,
    secondaryDetail: `${snapshot.filename} · ${formatBytes(snapshot.size)}`,
    tone: fresh ? "ready" : "warning",
    value: fresh ? "已备份" : "需要更新",
  };
}

function parseSettingsTargetSection(search: string): SettingsTargetSection | null {
  const section = new URLSearchParams(search).get("section");
  if (section === "ai" || section === "translate" || section === "sync") return section;
  return null;
}

function settingsCardClassName(
  baseClassName: string,
  section: SettingsTargetSection,
  targetSection: SettingsTargetSection | null,
): string {
  return targetSection === section ? `${baseClassName} settings-card--targeted` : baseClassName;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withMinimumBusyTime<T>(work: Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work;
  } finally {
    const remaining = MIN_SETTINGS_BUSY_MS - (Date.now() - startedAt);
    if (remaining > 0) await delay(remaining);
  }
}

function consumeSettingsSmokeFailure(key: SettingsSmokeFailureKey): Error | null {
  const smokeWindow = window as Window & Partial<Record<SettingsSmokeFailureKey, string>>;
  const message = smokeWindow[key];
  if (!message) return null;
  delete smokeWindow[key];
  return new Error(message);
}

export function SettingsPage() {
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { confirm, confirmDialog } = useConfirmDialog();
  const desktopRuntime = isDesktopRuntime();
  const targetSection = useMemo(
    () => parseSettingsTargetSection(location.search),
    [location.search],
  );
  const [aiKind, setAiKind] = useState<AiProviderKind>(() =>
    desktopRuntime ? DEFAULT_AI_SETTINGS.kind : PREVIEW_AI_SETTINGS.kind,
  );
  const [baseUrl, setBaseUrl] = useState(() =>
    desktopRuntime ? DEFAULT_AI_SETTINGS.baseUrl : PREVIEW_AI_SETTINGS.baseUrl,
  );
  const [model, setModel] = useState(() =>
    desktopRuntime ? DEFAULT_AI_SETTINGS.model : PREVIEW_AI_SETTINGS.model,
  );
  const [apiKey, setApiKey] = useState(() =>
    desktopRuntime ? DEFAULT_AI_SETTINGS.apiKey : PREVIEW_AI_SETTINGS.apiKey,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(() => desktopRuntime);
  const [aiSaving, setAiSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedAiSettings, setSavedAiSettings] = useState<AiSettingsSnapshot>(() =>
    desktopRuntime ? DEFAULT_AI_SETTINGS : PREVIEW_AI_SETTINGS,
  );

  const [trEngine, setTrEngine] = useState<TranslateEngine>(() =>
    desktopRuntime ? DEFAULT_TRANSLATE_SETTINGS.engine : PREVIEW_TRANSLATE_SETTINGS.engine,
  );
  const [trTarget, setTrTarget] = useState(() =>
    desktopRuntime ? DEFAULT_TRANSLATE_SETTINGS.targetLang : PREVIEW_TRANSLATE_SETTINGS.targetLang,
  );
  const [deeplKey, setDeeplKey] = useState(() =>
    desktopRuntime ? DEFAULT_TRANSLATE_SETTINGS.deeplKey : PREVIEW_TRANSLATE_SETTINGS.deeplKey,
  );
  const [baiduAppid, setBaiduAppid] = useState(() =>
    desktopRuntime ? DEFAULT_TRANSLATE_SETTINGS.baiduAppid : PREVIEW_TRANSLATE_SETTINGS.baiduAppid,
  );
  const [baiduKey, setBaiduKey] = useState(() =>
    desktopRuntime ? DEFAULT_TRANSLATE_SETTINGS.baiduKey : PREVIEW_TRANSLATE_SETTINGS.baiduKey,
  );
  const [trStatus, setTrStatus] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(() => desktopRuntime);
  const [translateSaving, setTranslateSaving] = useState(false);
  const [clearingTranslateCache, setClearingTranslateCache] = useState(false);
  const [savedTranslateSettings, setSavedTranslateSettings] = useState<TranslateSettingsSnapshot>(
    () => (desktopRuntime ? DEFAULT_TRANSLATE_SETTINGS : PREVIEW_TRANSLATE_SETTINGS),
  );

  const [davUrl, setDavUrl] = useState(() =>
    desktopRuntime ? DEFAULT_SYNC_SETTINGS.baseUrl : PREVIEW_SYNC_SETTINGS.baseUrl,
  );
  const [davUser, setDavUser] = useState(() =>
    desktopRuntime ? DEFAULT_SYNC_SETTINGS.username : PREVIEW_SYNC_SETTINGS.username,
  );
  const [davPass, setDavPass] = useState(() =>
    desktopRuntime ? DEFAULT_SYNC_SETTINGS.password : PREVIEW_SYNC_SETTINGS.password,
  );
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(() => desktopRuntime);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [savedSyncSettings, setSavedSyncSettings] = useState<SyncSettingsSnapshot>(() =>
    desktopRuntime ? DEFAULT_SYNC_SETTINGS : PREVIEW_SYNC_SETTINGS,
  );
  const [backupSafety, setBackupSafety] = useState<BackupSafetySnapshot | null>(() =>
    desktopRuntime ? readBackupSafetySnapshot() : PREVIEW_BACKUP_SAFETY,
  );
  const backupInputRef = useRef<HTMLInputElement>(null);
  const aiLoadSeqRef = useRef(0);
  const translateLoadSeqRef = useRef(0);
  const syncLoadSeqRef = useRef(0);

  const reloadAiSettings = useCallback(async () => {
    const seq = aiLoadSeqRef.current + 1;
    aiLoadSeqRef.current = seq;
    if (!desktopRuntime) {
      setAiKind(PREVIEW_AI_SETTINGS.kind);
      setBaseUrl(PREVIEW_AI_SETTINGS.baseUrl);
      setModel(PREVIEW_AI_SETTINGS.model);
      setApiKey(PREVIEW_AI_SETTINGS.apiKey);
      setSavedAiSettings(PREVIEW_AI_SETTINGS);
      setStatus("浏览器预览展示安全的演示配置；真实密钥只会保存在桌面应用。");
      setAiLoading(false);
      return;
    }
    setAiLoading(true);
    setStatus(null);
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_READ__",
      );
      if (smokeFailure) throw smokeFailure;
      const settings = await loadAiSettingsDraft();
      if (aiLoadSeqRef.current !== seq) return;
      if (!settings) {
        setSavedAiSettings(DEFAULT_AI_SETTINGS);
        return;
      }
      const kind = settings.kind ?? "openai-compatible";
      const fallback = providerDefaults(kind);
      const next = makeAiSettingsSnapshot(
        kind,
        settings.baseUrl || fallback.defaultBaseUrl,
        settings.model || fallback.defaultModel,
        settings.apiKey ?? "",
      );
      setAiKind(next.kind);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey(next.apiKey);
      setSavedAiSettings(next);
    } catch (error) {
      if (aiLoadSeqRef.current !== seq) return;
      setSavedAiSettings(DEFAULT_AI_SETTINGS);
      setStatus(`读取 AI 配置失败：${describeUnknownError(error)}`);
    } finally {
      if (aiLoadSeqRef.current === seq) setAiLoading(false);
    }
  }, [desktopRuntime]);

  const reloadTranslateSettings = useCallback(async () => {
    const seq = translateLoadSeqRef.current + 1;
    translateLoadSeqRef.current = seq;
    if (!desktopRuntime) {
      setTrEngine(PREVIEW_TRANSLATE_SETTINGS.engine);
      setTrTarget(PREVIEW_TRANSLATE_SETTINGS.targetLang);
      setDeeplKey(PREVIEW_TRANSLATE_SETTINGS.deeplKey);
      setBaiduAppid(PREVIEW_TRANSLATE_SETTINGS.baiduAppid);
      setBaiduKey(PREVIEW_TRANSLATE_SETTINGS.baiduKey);
      setSavedTranslateSettings(PREVIEW_TRANSLATE_SETTINGS);
      setTrStatus("预览使用大模型翻译演示配置；桌面应用会复用已保存的 AI 服务。");
      setTranslateLoading(false);
      return;
    }
    setTranslateLoading(true);
    setTrStatus(null);
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_READ__",
      );
      if (smokeFailure) throw smokeFailure;
      const config = await loadTranslateConfig();
      if (translateLoadSeqRef.current !== seq) return;
      const next = makeTranslateSettingsSnapshot(
        config.engine,
        config.targetLang,
        config.deepl?.apiKey ?? "",
        config.baidu?.appid ?? "",
        config.baidu?.key ?? "",
      );
      setTrEngine(next.engine);
      setTrTarget(next.targetLang);
      setDeeplKey(next.deeplKey);
      setBaiduAppid(next.baiduAppid);
      setBaiduKey(next.baiduKey);
      setSavedTranslateSettings(next);
    } catch (error) {
      if (translateLoadSeqRef.current !== seq) return;
      setSavedTranslateSettings(DEFAULT_TRANSLATE_SETTINGS);
      setTrStatus(`读取翻译配置失败：${describeUnknownError(error)}`);
    } finally {
      if (translateLoadSeqRef.current === seq) setTranslateLoading(false);
    }
  }, [desktopRuntime]);

  const reloadSyncSettings = useCallback(async () => {
    const seq = syncLoadSeqRef.current + 1;
    syncLoadSeqRef.current = seq;
    if (!desktopRuntime) {
      setDavUrl(PREVIEW_SYNC_SETTINGS.baseUrl);
      setDavUser(PREVIEW_SYNC_SETTINGS.username);
      setDavPass(PREVIEW_SYNC_SETTINGS.password);
      setSavedSyncSettings(PREVIEW_SYNC_SETTINGS);
      setBackupSafety(PREVIEW_BACKUP_SAFETY);
      setSyncStatus("浏览器预览展示 WebDAV 与整库备份演示状态；真实同步只在桌面应用运行。");
      setSyncLoading(false);
      return;
    }
    setSyncLoading(true);
    setSyncStatus(null);
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_READ__",
      );
      if (smokeFailure) throw smokeFailure;
      const settings = await loadSyncSettings();
      if (syncLoadSeqRef.current !== seq) return;
      if (!settings) {
        setSavedSyncSettings(DEFAULT_SYNC_SETTINGS);
        return;
      }
      const next = makeSyncSettingsSnapshot(settings.baseUrl, settings.username, settings.password);
      setDavUrl(next.baseUrl);
      setDavUser(next.username);
      setDavPass(next.password);
      setSavedSyncSettings(next);
    } catch (error) {
      if (syncLoadSeqRef.current !== seq) return;
      setSavedSyncSettings(DEFAULT_SYNC_SETTINGS);
      setSyncStatus(`读取同步配置失败：${describeUnknownError(error)}`);
    } finally {
      if (syncLoadSeqRef.current === seq) setSyncLoading(false);
    }
  }, [desktopRuntime]);

  useEffect(() => {
    const reloadId = window.setTimeout(() => {
      void reloadAiSettings();
      void reloadTranslateSettings();
      void reloadSyncSettings();
    }, 0);
    return () => {
      window.clearTimeout(reloadId);
      aiLoadSeqRef.current += 1;
      translateLoadSeqRef.current += 1;
      syncLoadSeqRef.current += 1;
    };
  }, [reloadAiSettings, reloadSyncSettings, reloadTranslateSettings]);

  useEffect(() => {
    if (!targetSection) return;
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-settings-section="${targetSection}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [targetSection]);

  const currentAiSettings = useMemo(
    () => makeAiSettingsSnapshot(aiKind, baseUrl, model, apiKey),
    [aiKind, apiKey, baseUrl, model],
  );
  const currentTranslateSettings = useMemo(
    () => makeTranslateSettingsSnapshot(trEngine, trTarget, deeplKey, baiduAppid, baiduKey),
    [baiduAppid, baiduKey, deeplKey, trEngine, trTarget],
  );
  const currentSyncSettings = useMemo(
    () => makeSyncSettingsSnapshot(davUrl, davUser, davPass),
    [davPass, davUrl, davUser],
  );

  const aiDirty = !sameAiSettings(currentAiSettings, savedAiSettings);
  const translateDirty = !sameTranslateSettings(currentTranslateSettings, savedTranslateSettings);
  const syncDirty = !sameSyncSettings(currentSyncSettings, savedSyncSettings);
  const dirtySections = useMemo(
    () =>
      [
        aiDirty ? "AI 服务" : null,
        translateDirty ? "阅读翻译" : null,
        syncDirty ? "同步与备份" : null,
      ].filter((item): item is string => Boolean(item)),
    [aiDirty, syncDirty, translateDirty],
  );
  const hasUnsavedChanges = dirtySections.length > 0;
  const aiBusy = aiLoading || aiSaving || testing;
  const translateBusy = translateLoading || translateSaving || clearingTranslateCache;
  const syncBusy = syncLoading || syncSaving || syncing || exportingBackup || importingBackup;
  const aiLoadFailed = !aiLoading && Boolean(status?.startsWith("读取 AI 配置失败"));
  const translateLoadFailed =
    !translateLoading && Boolean(trStatus?.startsWith("读取翻译配置失败"));
  const syncLoadFailed = !syncLoading && Boolean(syncStatus?.startsWith("读取同步配置失败"));
  const busySections = useMemo(
    () =>
      [
        aiSaving || testing ? "AI 服务" : null,
        translateSaving || clearingTranslateCache ? "阅读翻译" : null,
        syncSaving || syncing || exportingBackup || importingBackup ? "同步与备份" : null,
      ].filter((item): item is string => Boolean(item)),
    [
      aiSaving,
      clearingTranslateCache,
      exportingBackup,
      importingBackup,
      syncSaving,
      syncing,
      testing,
      translateSaving,
    ],
  );
  const hasPendingOperations = busySections.length > 0;

  useEffect(() => {
    if (!hasUnsavedChanges && !hasPendingOperations) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasPendingOperations, hasUnsavedChanges]);

  const aiConfigured = Boolean(
    apiKey.trim() && model.trim() && (aiKind === "anthropic" || baseUrl.trim()),
  );
  const translationReady =
    trEngine === "llm"
      ? aiConfigured
      : trEngine === "deepl"
        ? Boolean(deeplKey.trim())
        : Boolean(baiduAppid.trim() && baiduKey.trim());
  const syncConfigured = Boolean(davUrl.trim() && davUser.trim() && davPass.trim());
  const activeProvider = AI_PROVIDER_OPTIONS.find((option) => option.id === aiKind)!;
  const backupSafetyDisplay = useMemo(() => describeBackupSafety(backupSafety), [backupSafety]);

  const readinessItems = useMemo(
    () => [
      {
        label: "AI 生成",
        value: aiLoading
          ? "读取中"
          : aiLoadFailed
            ? "读取失败"
            : aiBusy
              ? "处理中"
              : aiDirty
                ? "未保存"
                : aiConfigured
                  ? "可用"
                  : "待配置",
        detail: aiLoading
          ? "正在读取本机配置"
          : aiLoadFailed
            ? "点击重试读取"
            : aiSaving
              ? "正在保存配置"
              : testing
                ? "正在测试连接"
                : aiDirty
                  ? "保存后生效"
                  : aiConfigured
                    ? model.trim()
                    : "需要模型与 API Key",
        tone: aiBusy || aiDirty || aiLoadFailed ? "warning" : aiConfigured ? "ready" : "warning",
      },
      {
        label: "翻译",
        value: translateLoading
          ? "读取中"
          : translateLoadFailed
            ? "读取失败"
            : translateBusy
              ? "处理中"
              : translateDirty
                ? "未保存"
                : translationReady
                  ? "可用"
                  : "待配置",
        detail: translateLoading
          ? "正在读取本机配置"
          : translateLoadFailed
            ? "点击重试读取"
            : translateSaving
              ? "正在保存配置"
              : clearingTranslateCache
                ? "正在清除缓存"
                : translateDirty
                  ? "保存后生效"
                  : trEngine === "llm"
                    ? "复用 AI 服务"
                    : translateEngineLabel(trEngine),
        tone:
          translateBusy || translateDirty || translateLoadFailed
            ? "warning"
            : translationReady
              ? "ready"
              : "warning",
      },
      {
        label: "同步",
        value: syncLoading
          ? "读取中"
          : syncLoadFailed
            ? "读取失败"
            : syncBusy
              ? "处理中"
              : syncDirty
                ? "未保存"
                : syncConfigured
                  ? "已配置"
                  : "可选",
        detail: syncLoading
          ? "正在读取本机配置"
          : syncLoadFailed
            ? "点击重试读取"
            : syncSaving
              ? "正在保存配置"
              : syncing
                ? "正在同步"
                : exportingBackup
                  ? "正在导出备份"
                  : importingBackup
                    ? "正在导入备份"
                    : syncDirty
                      ? "保存后生效"
                      : syncConfigured
                        ? urlSafeHost(davUrl)
                        : "WebDAV / JSON 备份",
        tone:
          syncBusy || syncDirty || syncLoadFailed ? "warning" : syncConfigured ? "ready" : "muted",
      },
      {
        label: "整库备份",
        value: exportingBackup ? "导出中" : backupSafetyDisplay.value,
        detail: exportingBackup ? "正在生成 JSON" : backupSafetyDisplay.detail,
        tone: exportingBackup ? "warning" : backupSafetyDisplay.tone,
      },
      {
        label: "运行环境",
        value: desktopRuntime ? "桌面安全存储" : "浏览器预览",
        detail: desktopRuntime ? "密钥加密保存在本机" : "密钥不会写入安全存储",
        tone: desktopRuntime ? "ready" : "warning",
      },
    ],
    [
      aiConfigured,
      aiBusy,
      aiDirty,
      aiLoadFailed,
      aiLoading,
      aiSaving,
      backupSafetyDisplay,
      clearingTranslateCache,
      davUrl,
      desktopRuntime,
      exportingBackup,
      importingBackup,
      model,
      syncConfigured,
      syncBusy,
      syncDirty,
      syncLoadFailed,
      syncLoading,
      syncSaving,
      syncing,
      testing,
      trEngine,
      translateBusy,
      translateDirty,
      translateLoadFailed,
      translateLoading,
      translationReady,
      translateSaving,
    ],
  );

  const selectProvider = (kind: AiProviderKind) => {
    const option = AI_PROVIDER_OPTIONS.find((item) => item.id === kind)!;
    setAiKind(kind);
    setStatus(null);
    if (kind === "anthropic") {
      if (!model.trim() || aiKind !== "anthropic") setModel(option.defaultModel);
      if (baseUrl.includes("deepseek") || baseUrl.includes("openai")) setBaseUrl("");
      return;
    }
    if (!baseUrl.trim() || aiKind !== "openai-compatible") setBaseUrl(option.defaultBaseUrl);
    if (!model.trim() || aiKind !== "openai-compatible") setModel(option.defaultModel);
  };

  const resetAiChanges = () => {
    setAiKind(savedAiSettings.kind);
    setBaseUrl(savedAiSettings.baseUrl);
    setModel(savedAiSettings.model);
    setApiKey(savedAiSettings.apiKey);
    setStatus(null);
  };

  const resetTranslateChanges = () => {
    setTrEngine(savedTranslateSettings.engine);
    setTrTarget(savedTranslateSettings.targetLang);
    setDeeplKey(savedTranslateSettings.deeplKey);
    setBaiduAppid(savedTranslateSettings.baiduAppid);
    setBaiduKey(savedTranslateSettings.baiduKey);
    setTrStatus(null);
  };

  const resetSyncChanges = () => {
    setDavUrl(savedSyncSettings.baseUrl);
    setDavUser(savedSyncSettings.username);
    setDavPass(savedSyncSettings.password);
    setSyncStatus(null);
  };

  const validateAiConfig = (): string | null => {
    if (!model.trim()) return "请填写模型名称。";
    const endpoint = normalizeAiBaseUrl(aiKind, baseUrl);
    if (!endpoint.ok) return endpoint.message;
    if (!apiKey.trim()) return "请填写 API Key。本地兼容端点也可以填写占位 Key。";
    return null;
  };

  const save = async (): Promise<boolean> => {
    if (aiBusy) return false;
    const error = validateAiConfig();
    if (error) {
      setStatus(error);
      return false;
    }
    const normalizedBaseUrl = normalizeAiBaseUrl(aiKind, baseUrl);
    if (!normalizedBaseUrl.ok) {
      setStatus(normalizedBaseUrl.message);
      return false;
    }
    const next = { ...currentAiSettings, baseUrl: normalizedBaseUrl.value };
    if (!desktopRuntime) {
      setAiSaving(true);
      setStatus("正在模拟保存 AI 配置...");
      await withMinimumBusyTime(delay(0));
      setAiKind(next.kind);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey(next.apiKey);
      setSavedAiSettings(next);
      setAiSaving(false);
      setStatus("预览已模拟保存；真实 API Key 只会在桌面应用中加密保存。");
      return true;
    }
    setAiSaving(true);
    setStatus("保存中...");
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_SAVE__",
      );
      await withMinimumBusyTime(smokeFailure ? Promise.reject(smokeFailure) : saveAiSettings(next));
    } catch (e) {
      setStatus(`保存失败，修改仍保留，可重新保存：${describeUnknownError(e)}`);
      return false;
    } finally {
      setAiSaving(false);
    }
    setAiKind(next.kind);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setApiKey(next.apiKey);
    setSavedAiSettings(next);
    window.dispatchEvent(new Event(AI_SETTINGS_UPDATED_EVENT));
    setStatus("已保存，新的 AI 配置会用于摘要、观点合成与翻译。");
    return true;
  };

  const test = async () => {
    if (aiBusy) return;
    const saved = await save();
    if (!saved) return;
    setTesting(true);
    setStatus("测试中...");
    if (!desktopRuntime) {
      await withMinimumBusyTime(delay(0));
      setStatus(`预览连接成功，模型 ${model.trim()} 已可用于摘要、观点合成与翻译演示。`);
      setTesting(false);
      return;
    }
    try {
      const res = await withMinimumBusyTime(
        (async () => {
          const smokeFailure = consumeSettingsSmokeFailure(
            "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_AI_TEST__",
          );
          if (smokeFailure) throw smokeFailure;
          const provider = await makeProvider();
          if (!provider) throw new Error("配置不完整");
          return provider.generateText({
            messages: [{ role: "user", content: "Reply with exactly: ok" }],
            maxTokens: 10,
          });
        })(),
      );
      setStatus(`连接成功，模型回复：${res.text.slice(0, 50)}`);
    } catch (e) {
      setStatus(`连接失败，配置已保存，可修改后重新测试：${describeUnknownError(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const saveTranslate = async () => {
    if (translateBusy) return;
    const next = currentTranslateSettings;
    const error = validateTranslateConfig(next);
    if (error) {
      setTrStatus(error);
      return;
    }
    if (!desktopRuntime) {
      setTranslateSaving(true);
      setTrStatus("正在模拟保存翻译配置...");
      await withMinimumBusyTime(delay(0));
      setTrEngine(next.engine);
      setTrTarget(next.targetLang);
      setDeeplKey(next.deeplKey);
      setBaiduAppid(next.baiduAppid);
      setBaiduKey(next.baiduKey);
      setSavedTranslateSettings(next);
      setTranslateSaving(false);
      setTrStatus("预览已模拟保存；真实翻译密钥只会在桌面应用中保存。");
      return;
    }
    setTranslateSaving(true);
    setTrStatus("保存中...");
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_TRANSLATE_SAVE__",
      );
      await withMinimumBusyTime(
        smokeFailure
          ? Promise.reject(smokeFailure)
          : saveTranslateConfig({
              engine: next.engine,
              targetLang: next.targetLang,
              deepl: next.deeplKey ? { apiKey: next.deeplKey } : undefined,
              baidu:
                next.baiduAppid && next.baiduKey
                  ? { appid: next.baiduAppid, key: next.baiduKey }
                  : undefined,
            }),
      );
    } catch (e) {
      setTrStatus(`保存失败，修改仍保留，可重新保存：${describeUnknownError(e)}`);
      return;
    } finally {
      setTranslateSaving(false);
    }
    setTrEngine(next.engine);
    setTrTarget(next.targetLang);
    setDeeplKey(next.deeplKey);
    setBaiduAppid(next.baiduAppid);
    setBaiduKey(next.baiduKey);
    setSavedTranslateSettings(next);
    if (!desktopRuntime && (next.deeplKey || next.baiduKey)) {
      setTrStatus("浏览器预览无法保存翻译密钥，请在桌面应用中完成配置。");
    } else if (next.engine === "llm" && !aiConfigured) {
      setTrStatus("已保存；大模型翻译还需要先配置 AI 服务。");
    } else {
      setTrStatus("已保存。");
    }
  };

  const clearTrCache = async () => {
    if (translateBusy) return;
    if (!desktopRuntime) {
      setClearingTranslateCache(true);
      setTrStatus("正在模拟清除翻译缓存...");
      await withMinimumBusyTime(delay(0));
      setClearingTranslateCache(false);
      setTrStatus("预览已模拟清除 18 条翻译缓存；桌面应用会清理真实本机缓存。");
      return;
    }
    const confirmed = await confirm({
      cancelLabel: "保留缓存",
      confirmLabel: "清除缓存",
      description: "这会删除本机已缓存的翻译结果。之后再次翻译相同段落时，需要重新调用翻译服务。",
      details: [
        "不会删除 PDF、批注、题录或翻译配置。",
        "如果翻译服务按量计费，重新翻译可能产生新的额度消耗。",
      ],
      title: "清除翻译缓存？",
      tone: "warning",
    });
    if (!confirmed) {
      setTrStatus("已取消清除翻译缓存。");
      return;
    }
    setClearingTranslateCache(true);
    setTrStatus("正在清除翻译缓存...");
    try {
      const n = await withMinimumBusyTime(clearTranslationCache());
      setTrStatus(`已清除 ${n} 条翻译缓存。`);
    } catch (e) {
      setTrStatus(`清除失败：${describeUnknownError(e)}`);
    } finally {
      setClearingTranslateCache(false);
    }
  };

  const saveSyncOnly = async (): Promise<boolean> => {
    if (syncBusy) return false;
    const normalizedDavUrl = normalizeWebDavBaseUrl(davUrl);
    if (!normalizedDavUrl.ok) {
      setSyncStatus(normalizedDavUrl.message);
      return false;
    }
    if (!davUser.trim() || !davPass.trim()) {
      setSyncStatus("请填写用户名和密码 / 应用密码。");
      return false;
    }
    if (!desktopRuntime) {
      const next = { ...currentSyncSettings, baseUrl: normalizedDavUrl.value };
      setSyncSaving(true);
      setSyncStatus("正在模拟保存同步配置...");
      await withMinimumBusyTime(delay(0));
      setDavUrl(next.baseUrl);
      setDavUser(next.username);
      setDavPass(next.password);
      setSavedSyncSettings(next);
      setSyncSaving(false);
      setSyncStatus("预览已模拟保存；真实 WebDAV 密码只会在桌面应用中保存。");
      return true;
    }
    const next = { ...currentSyncSettings, baseUrl: normalizedDavUrl.value };
    setSyncSaving(true);
    setSyncStatus("正在保存同步配置...");
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_SAVE__",
      );
      await withMinimumBusyTime(
        smokeFailure ? Promise.reject(smokeFailure) : saveSyncSettings(next),
      );
    } catch (e) {
      setSyncStatus(`保存失败，修改仍保留，可重新保存：${describeUnknownError(e)}`);
      return false;
    } finally {
      setSyncSaving(false);
    }
    setDavUrl(next.baseUrl);
    setDavUser(next.username);
    setDavPass(next.password);
    setSavedSyncSettings(next);
    setSyncStatus("同步配置已保存。");
    return true;
  };

  const handleSync = async () => {
    if (syncBusy) return;
    const saved = await saveSyncOnly();
    if (!saved) return;
    if (!desktopRuntime) {
      setSyncing(true);
      setSyncStatus("正在模拟同步...");
      await withMinimumBusyTime(delay(0));
      setSyncing(false);
      setSyncStatus("预览同步完成：推送 2 条，拉取 1 条，应用 1 条；真实同步只在桌面应用运行。");
      return;
    }
    setSyncing(true);
    setSyncStatus("同步中...");
    try {
      const smokeFailure = consumeSettingsSmokeFailure(
        "__AURASCHOLAR_SMOKE_SETTINGS_FAIL_NEXT_SYNC_RUN__",
      );
      const r = await withMinimumBusyTime(smokeFailure ? Promise.reject(smokeFailure) : runSync());
      setSyncStatus(formatSyncSuccessStatus(r));
    } catch (e) {
      setSyncStatus(`同步失败，配置已保留，可重新同步：${describeSyncRunError(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    if (syncBusy) return;
    if (!desktopRuntime) {
      setExportingBackup(true);
      setSyncStatus("正在模拟导出整库备份...");
      await withMinimumBusyTime(delay(0));
      setBackupSafety(PREVIEW_BACKUP_SAFETY);
      setExportingBackup(false);
      setSyncStatus(
        `预览已模拟导出：${PREVIEW_BACKUP_SAFETY.filename}（${formatBytes(PREVIEW_BACKUP_SAFETY.size)}）。桌面应用会生成真实 JSON 文件。`,
      );
      return;
    }
    setExportingBackup(true);
    setSyncStatus("正在导出整库备份...");
    try {
      const blob = await withMinimumBusyTime(exportLibraryJson());
      const exportedAt = new Date();
      const filename = downloadBlob(
        blob,
        `aurascholar-backup-${exportedAt.toISOString().slice(0, 10)}.json`,
      );
      const snapshot: BackupSafetySnapshot = {
        exportedAt: exportedAt.toISOString(),
        filename,
        size: blob.size,
        version: 1,
      };
      const safetySaved = saveBackupSafetySnapshot(snapshot);
      setBackupSafety(snapshot);
      setSyncStatus(
        `整库 JSON 备份已导出：${filename}（${formatBytes(blob.size)}）。` +
          (safetySaved ? "" : " 本机备份记录未能保存。"),
      );
    } catch (e) {
      setSyncStatus(`导出失败：${describeUnknownError(e)}`);
    } finally {
      setExportingBackup(false);
    }
  };

  const handleBackupFile = async (file: File) => {
    if (syncBusy) return;
    try {
      const text = await file.text();
      const preview = previewLibraryBackupJson(text);
      const ignoredTablesText = formatBackupIgnoredTables(preview.ignoredTables);
      if (preview.totalRows === 0) {
        setSyncStatus(
          preview.ignoredTables.length > 0
            ? `备份文件里没有可导入的用户数据；已识别并忽略 ${ignoredTablesText}。`
            : "备份文件里没有可导入的数据。",
        );
        return;
      }
      const tableSummary = preview.tables
        .slice(0, 6)
        .map((table) => `${table.name} ${table.rows} 条`)
        .join("、");
      const ignoredTableSummary =
        preview.ignoredTables.length > 0
          ? `将忽略 ${ignoredTablesText}；缓存、同步运行态和本机临时数据会在使用时重新生成。`
          : "缓存、同步运行态和本机临时数据不会随备份恢复，会在使用时重新生成。";
      const previewOnly = !desktopRuntime;
      const confirmed = await confirm({
        cancelLabel: "取消",
        confirmLabel: previewOnly ? "模拟导入" : "合并导入",
        description: (
          <>
            {previewOnly ? "将模拟从" : "将从"} <strong>{file.name}</strong>{" "}
            {previewOnly ? "导入" : "合并导入"} {preview.totalRows} 条备份记录。
          </>
        ),
        details: [
          preview.exportedAt ? `备份时间：${preview.exportedAt}` : "备份时间未标注。",
          tableSummary + (preview.tables.length > 6 ? ` 等 ${preview.tables.length} 张表。` : "。"),
          previewOnly
            ? "当前是浏览器预览，确认后只会模拟导入结果，不写入真实文献库。"
            : "只补充当前库中不存在的记录；同主键或同唯一标识的数据会跳过，不会覆盖当前内容。",
          "JSON 备份不包含 PDF 文件本体；附件记录会作为待重新挂载的元数据保留，不会显示为可读 PDF。",
          "JSON 备份也不包含任何 API Key / 密码。",
          ignoredTableSummary,
        ],
        eyebrow: "备份导入",
        title: previewOnly ? "模拟导入整库备份？" : "合并导入整库备份？",
        tone: "warning",
      });
      if (!confirmed) {
        setSyncStatus("已取消导入备份。");
        return;
      }
      setImportingBackup(true);
      if (previewOnly) {
        setSyncStatus("正在模拟导入备份...");
        await withMinimumBusyTime(delay(0));
        setBackupSafety({
          exportedAt: preview.exportedAt ?? new Date().toISOString(),
          filename: file.name,
          size: file.size,
          version: 1,
        });
        setSyncStatus(
          `预览已模拟导入 ${preview.totalRows} 条备份记录；真实合并、去重和 PDF 重挂载会在桌面应用中完成。`,
        );
        return;
      }
      setSyncStatus("正在合并导入备份...");
      const summary = await withMinimumBusyTime(importLibraryBackupJson(text));
      setSyncStatus(formatBackupImportSuccessStatus(summary));
    } catch (e) {
      setSyncStatus(`导入失败，当前库未写入任何备份数据，可重新导入：${describeUnknownError(e)}`);
    } finally {
      setImportingBackup(false);
    }
  };

  const scrollToSection = useCallback((section: SettingsSection) => {
    const target = document.querySelector<HTMLElement>(`[data-settings-section="${section}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }, []);

  return (
    <div className="settings-page settings-page--control">
      <header className="settings-header">
        <h1 className="app-page-title">设置</h1>
        <p className="app-page-subtitle">管理模型、阅读翻译、同步与本地数据。</p>
      </header>

      <div className="settings-workspace">
        <aside className="settings-rail">
          <nav className="settings-section-nav" aria-label="设置分区">
            <span className="settings-rail__eyebrow">设置分区</span>
            {[
              ["appearance", "01", "外观"],
              ["ai", "02", "AI 服务"],
              ["translate", "03", "阅读翻译"],
              ["sync", "04", "同步与备份"],
            ].map(([section, index, label]) => (
              <button
                key={section}
                type="button"
                onClick={() => scrollToSection(section as SettingsSection)}
              >
                <span>{index}</span>
                <strong>{label}</strong>
              </button>
            ))}
          </nav>

          <div className="settings-readiness" aria-label="配置状态">
            <span className="settings-rail__eyebrow">运行状态</span>
            {readinessItems.map((item) => (
              <ReadinessItem key={item.label} {...item} />
            ))}
          </div>
        </aside>

        <div className="settings-content">
          {!desktopRuntime && (
            <Card className="settings-preview-note">
              <Badge variant="warning">预览</Badge>
              <div>
                <strong>当前是浏览器预览环境</strong>
                <p>布局可体验；密钥、数据库、同步与连接测试需在桌面应用中完成。</p>
              </div>
            </Card>
          )}

          {(hasUnsavedChanges || hasPendingOperations) && (
            <SettingsNavigationGuard
              busySections={busySections}
              confirm={confirm}
              dirtySections={dirtySections}
            />
          )}

          {hasUnsavedChanges && (
            <Card className="settings-unsaved-banner" role="status" aria-live="polite">
              <Badge variant="warning">未保存</Badge>
              <div>
                <strong>有配置尚未保存</strong>
                <p>{dirtySections.join("、")} 的修改需要保存后才会用于后续研究流程。</p>
              </div>
            </Card>
          )}

          {hasPendingOperations && (
            <Card className="settings-unsaved-banner" role="status" aria-live="polite">
              <Badge variant="warning">处理中</Badge>
              <div>
                <strong>配置操作正在进行</strong>
                <p>{busySections.join("、")} 正在处理，请等待完成后再离开或继续修改相关配置。</p>
              </div>
            </Card>
          )}

          <div className="settings-grid">
            <Card
              className="settings-card settings-card--compact"
              data-settings-section="appearance"
              tabIndex={-1}
            >
              <SettingsCardHeader
                title="外观"
                badge={theme === "dawn" ? "Dawn" : "Nocturne"}
                description="选择适合白天整理或夜间阅读的界面模式。"
              />
              <div className="settings-theme-options">
                <Button
                  variant={theme === "dawn" ? "primary" : "secondary"}
                  onClick={() => setTheme("dawn")}
                >
                  Dawn · 清爽学术
                </Button>
                <Button
                  variant={theme === "nocturne" ? "primary" : "secondary"}
                  onClick={() => setTheme("nocturne")}
                >
                  Nocturne · 夜间研究
                </Button>
              </div>
            </Card>

            <Card
              className={settingsCardClassName(
                "settings-card settings-card--ai",
                "ai",
                targetSection,
              )}
              data-settings-section="ai"
              tabIndex={targetSection === "ai" ? -1 : undefined}
            >
              <SettingsCardHeader
                title="AI 服务"
                badge={activeProvider.label}
                dirty={aiDirty}
                description="AuraScholar 不内置云端账号，摘要、研究合成和翻译都走你自己的模型服务。"
              />

              <div className="settings-provider-grid" role="group" aria-label="AI 服务类型">
                {AI_PROVIDER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={
                      aiKind === option.id
                        ? "settings-provider-option settings-provider-option--active"
                        : "settings-provider-option"
                    }
                    type="button"
                    disabled={aiBusy}
                    onClick={() => selectProvider(option.id)}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <Badge variant="neutral">{option.badge}</Badge>
                    </span>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>

              <form
                className="settings-config-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div className="settings-form-grid">
                  <Field
                    label={`API 地址${aiKind === "anthropic" ? "（可留空）" : ""}`}
                    hint={
                      aiKind === "anthropic"
                        ? "留空时使用 Anthropic 官方端点。"
                        : "需要包含 /v1；本地端点可使用 http://127.0.0.1:11434/v1。"
                    }
                  >
                    <Input
                      disabled={aiBusy}
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setStatus(null);
                      }}
                      placeholder={activeProvider.defaultBaseUrl || "https://api.anthropic.com"}
                    />
                  </Field>
                  <Field label="模型" hint="填写服务商控制台中可用的模型名。">
                    <Input
                      disabled={aiBusy}
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setStatus(null);
                      }}
                      placeholder={activeProvider.defaultModel}
                    />
                  </Field>
                  <Field label="API Key" hint="密钥通过桌面安全存储加密保存，不写入同步数据。">
                    <Input
                      disabled={aiBusy}
                      name="ai-api-key"
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setStatus(null);
                      }}
                      placeholder="sk-..."
                    />
                  </Field>
                </div>

                <ActionRow status={aiLoading ? "正在读取 AI 配置..." : status}>
                  <Button type="submit" disabled={aiBusy} aria-busy={aiSaving || undefined}>
                    {aiSaving ? "保存中..." : "保存 AI 配置"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void test()}
                    disabled={aiBusy}
                    aria-busy={testing || undefined}
                  >
                    {testing ? "测试中..." : "测试连接"}
                  </Button>
                  {aiLoadFailed && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void reloadAiSettings()}
                      disabled={aiBusy}
                      aria-label="重试读取 AI 配置"
                    >
                      重试读取
                    </Button>
                  )}
                  {aiDirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetAiChanges}
                      disabled={aiBusy}
                    >
                      撤销修改
                    </Button>
                  )}
                </ActionRow>
              </form>
            </Card>

            <Card
              className={settingsCardClassName("settings-card", "translate", targetSection)}
              data-settings-section="translate"
              tabIndex={targetSection === "translate" ? -1 : undefined}
            >
              <SettingsCardHeader
                title="阅读翻译"
                badge={translateEngineLabel(trEngine)}
                dirty={translateDirty}
                description="阅读器划词翻译会优先复用缓存，重复段落不会反复消耗额度。"
              />

              <form
                className="settings-config-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTranslate();
                }}
              >
                <SegmentedControl
                  label="翻译引擎"
                  value={trEngine}
                  options={[
                    { id: "llm", label: "大模型" },
                    { id: "deepl", label: "DeepL" },
                    { id: "baidu", label: "百度翻译" },
                  ]}
                  disabled={translateBusy}
                  onChange={(value) => {
                    setTrEngine(value as TranslateEngine);
                    setTrStatus(null);
                  }}
                />

                <Field label="目标语言">
                  <select
                    className="au-input"
                    disabled={translateBusy}
                    value={trTarget}
                    onChange={(e) => {
                      setTrTarget(e.target.value);
                      setTrStatus(null);
                    }}
                  >
                    {TARGET_LANGS.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </Field>

                {trEngine === "deepl" && (
                  <Field label="DeepL API Key">
                    <Input
                      disabled={translateBusy}
                      name="deepl-api-key"
                      type="password"
                      autoComplete="off"
                      value={deeplKey}
                      onChange={(e) => {
                        setDeeplKey(e.target.value);
                        setTrStatus(null);
                      }}
                      placeholder="xxxxxxxx-xxxx-...:fx"
                    />
                  </Field>
                )}

                {trEngine === "baidu" && (
                  <>
                    <Field label="百度翻译 APPID">
                      <Input
                        disabled={translateBusy}
                        value={baiduAppid}
                        onChange={(e) => {
                          setBaiduAppid(e.target.value);
                          setTrStatus(null);
                        }}
                      />
                    </Field>
                    <Field label="百度翻译密钥">
                      <Input
                        disabled={translateBusy}
                        name="baidu-translate-key"
                        type="password"
                        autoComplete="off"
                        value={baiduKey}
                        onChange={(e) => {
                          setBaiduKey(e.target.value);
                          setTrStatus(null);
                        }}
                      />
                    </Field>
                  </>
                )}

                <ActionRow status={translateLoading ? "正在读取翻译配置..." : trStatus}>
                  <Button
                    type="submit"
                    disabled={translateBusy}
                    aria-busy={translateSaving || undefined}
                  >
                    {translateSaving ? "保存中..." : "保存翻译配置"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void clearTrCache()}
                    disabled={translateBusy}
                    aria-busy={clearingTranslateCache || undefined}
                  >
                    {clearingTranslateCache ? "清除中..." : "清除翻译缓存"}
                  </Button>
                  {translateLoadFailed && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void reloadTranslateSettings()}
                      disabled={translateBusy}
                      aria-label="重试读取翻译配置"
                    >
                      重试读取
                    </Button>
                  )}
                  {translateDirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetTranslateChanges}
                      disabled={translateBusy}
                    >
                      撤销修改
                    </Button>
                  )}
                </ActionRow>
              </form>
            </Card>

            <Card
              className={settingsCardClassName("settings-card", "sync", targetSection)}
              data-settings-section="sync"
              tabIndex={targetSection === "sync" ? -1 : undefined}
            >
              <SettingsCardHeader
                title="同步与备份"
                badge="WebDAV"
                dirty={syncDirty}
                description="WebDAV 同步题录、批注和检索状态；空间白板暂通过整库 JSON 备份跨设备迁移。"
              />

              <form
                className="settings-config-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveSyncOnly();
                }}
              >
                <div className="settings-form-grid">
                  <Field label="WebDAV 地址">
                    <Input
                      disabled={syncBusy}
                      value={davUrl}
                      onChange={(e) => {
                        setDavUrl(e.target.value);
                        setSyncStatus(null);
                      }}
                      placeholder="https://dav.jianguoyun.com/dav/AuraScholar"
                    />
                  </Field>
                  <Field label="用户名">
                    <Input
                      disabled={syncBusy}
                      name="webdav-username"
                      autoComplete="username"
                      value={davUser}
                      onChange={(e) => {
                        setDavUser(e.target.value);
                        setSyncStatus(null);
                      }}
                    />
                  </Field>
                  <Field label="密码 / 应用密码">
                    <Input
                      disabled={syncBusy}
                      name="webdav-password"
                      type="password"
                      autoComplete="current-password"
                      value={davPass}
                      onChange={(e) => {
                        setDavPass(e.target.value);
                        setSyncStatus(null);
                      }}
                    />
                  </Field>
                </div>

                <div
                  className={`settings-backup-safety settings-backup-safety--${backupSafetyDisplay.tone}`}
                  aria-label="备份状态"
                >
                  <div>
                    <span>最近备份</span>
                    <strong>{backupSafetyDisplay.value}</strong>
                    <small>{backupSafetyDisplay.detail}</small>
                  </div>
                  <div>
                    <span>备份文件</span>
                    <strong>{backupSafety ? formatBytes(backupSafety.size) : "待导出"}</strong>
                    <small>
                      {backupSafety ? backupSafety.filename : backupSafetyDisplay.secondaryDetail}
                    </small>
                  </div>
                  <div>
                    <span>恢复提醒</span>
                    <strong>PDF 需重挂载</strong>
                    <small>题录、批注和素材会先恢复</small>
                  </div>
                </div>

                <ActionRow status={syncLoading ? "正在读取同步配置..." : syncStatus}>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={syncBusy}
                    aria-busy={syncSaving || undefined}
                  >
                    {syncSaving ? "保存中..." : "保存同步配置"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleSync()}
                    disabled={syncBusy}
                    aria-busy={syncing || undefined}
                  >
                    {syncing ? "同步中..." : "立即同步"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleExport()}
                    disabled={syncBusy}
                    aria-busy={exportingBackup || undefined}
                  >
                    {exportingBackup ? "导出中..." : "导出整库备份"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => backupInputRef.current?.click()}
                    disabled={syncBusy}
                    aria-busy={importingBackup || undefined}
                  >
                    {importingBackup ? "导入中..." : "导入备份"}
                  </Button>
                  {syncLoadFailed && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void reloadSyncSettings()}
                      disabled={syncBusy}
                      aria-label="重试读取同步配置"
                    >
                      重试读取
                    </Button>
                  )}
                  {syncDirty && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetSyncChanges}
                      disabled={syncBusy}
                    >
                      撤销修改
                    </Button>
                  )}
                </ActionRow>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleBackupFile(file);
                    event.target.value = "";
                  }}
                />
              </form>
            </Card>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

function SettingsCardHeader({
  title,
  badge,
  dirty,
  description,
}: {
  title: string;
  badge: string;
  dirty?: boolean;
  description: string;
}) {
  return (
    <div className="settings-card__head">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="settings-card__badges">
        <Badge variant="neutral">{badge}</Badge>
        {dirty && <Badge variant="warning">未保存</Badge>}
      </div>
    </div>
  );
}

function ReadinessItem({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <span className={`settings-readiness__item settings-readiness__item--${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{detail}</em>
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function SegmentedControl({
  disabled = false,
  label,
  value,
  options,
  onChange,
}: {
  disabled?: boolean;
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-segmented">
      <span>{label}</span>
      <div role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            className={value === option.id ? "settings-segmented__active" : ""}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionRow({ children, status }: { children: ReactNode; status: string | null }) {
  return (
    <div className="settings-actions">
      <div>{children}</div>
      <InlineNotice className="settings-status" message={status} />
    </div>
  );
}

function SettingsNavigationGuard({
  busySections,
  confirm,
  dirtySections,
}: {
  busySections: string[];
  confirm: ConfirmFunction;
  dirtySections: string[];
}) {
  const blockerDialogOpenRef = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search,
  );

  useEffect(() => {
    if (blocker.state === "unblocked") {
      blockerDialogOpenRef.current = false;
    }
  }, [blocker.state]);

  useEffect(() => {
    if (blocker.state !== "blocked" || blockerDialogOpenRef.current) return;
    blockerDialogOpenRef.current = true;
    const sectionLabels = dirtySections.join("、") || "设置";
    const busyLabels = busySections.join("、");
    const details = [
      dirtySections.length > 0 ? `未保存区块：${sectionLabels}` : null,
      busySections.length > 0 ? `正在处理：${busyLabels}` : null,
      dirtySections.length > 0 ? "保存后，新的配置才会用于摘要、翻译、同步等流程。" : null,
      busySections.length > 0 ? "等待处理完成后，页面会显示明确的成功或失败反馈。" : null,
    ].filter((item): item is string => Boolean(item));
    void confirm({
      cancelLabel: "继续编辑",
      confirmLabel: "仍然离开",
      description:
        busySections.length > 0
          ? "当前有设置操作正在进行，离开页面可能错过结果反馈。"
          : "离开设置页会丢失尚未保存的配置修改。",
      details,
      eyebrow: busySections.length > 0 ? "处理中" : "未保存",
      title: "要离开设置页吗？",
      tone: "warning",
    }).then((confirmed) => {
      blockerDialogOpenRef.current = false;
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    });
  }, [blocker, busySections, confirm, dirtySections]);

  return null;
}

function translateEngineLabel(engine: TranslateEngine) {
  if (engine === "deepl") return "DeepL";
  if (engine === "baidu") return "百度翻译";
  return "大模型";
}

function urlSafeHost(value: string): string {
  const url = newURL(value);
  return url?.host || "WebDAV 已填写";
}

function newURL(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function providerDefaults(kind: AiProviderKind): (typeof AI_PROVIDER_OPTIONS)[number] {
  return AI_PROVIDER_OPTIONS.find((option) => option.id === kind) ?? DEFAULT_AI_PROVIDER_OPTION;
}

function makeAiSettingsSnapshot(
  kind: AiProviderKind,
  baseUrl: string,
  model: string,
  apiKey: string,
): AiSettingsSnapshot {
  return {
    kind,
    baseUrl: kind === "anthropic" ? baseUrl.trim() : baseUrl.trim().replace(/\/$/, ""),
    model: model.trim(),
    apiKey: apiKey.trim(),
  };
}

function makeTranslateSettingsSnapshot(
  engine: TranslateEngine,
  targetLang: string,
  deeplKey: string,
  baiduAppid: string,
  baiduKey: string,
): TranslateSettingsSnapshot {
  return {
    engine,
    targetLang: targetLang.trim() || DEFAULT_TRANSLATE_SETTINGS.targetLang,
    deeplKey: deeplKey.trim(),
    baiduAppid: baiduAppid.trim(),
    baiduKey: baiduKey.trim(),
  };
}

function validateTranslateConfig(settings: TranslateSettingsSnapshot): string | null {
  if (settings.engine === "deepl" && !settings.deeplKey) {
    return "请填写 DeepL API Key，或切换为大模型翻译。";
  }
  if (settings.engine === "baidu" && (!settings.baiduAppid || !settings.baiduKey)) {
    return "请填写百度翻译 APPID 和密钥，或切换为大模型翻译。";
  }
  return null;
}

function makeSyncSettingsSnapshot(
  baseUrl: string,
  username: string,
  password: string,
): SyncSettingsSnapshot {
  return {
    baseUrl: baseUrl.trim(),
    username: username.trim(),
    password,
  };
}

function normalizeAiBaseUrl(kind: AiProviderKind, value: string): SettingsUrlValidation {
  const raw = value.trim();
  if (!raw) {
    return kind === "anthropic"
      ? { ok: true, value: "" }
      : { message: "请填写 OpenAI 兼容 API 地址。", ok: false };
  }
  const url = newURL(raw);
  if (!url) {
    return {
      message: "AI API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。",
      ok: false,
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      message: "AI API 地址仅支持 http:// 或 https://。",
      ok: false,
    };
  }
  if (url.username || url.password) {
    return {
      message: "AI API 地址不要包含密钥或账号，请填写在 API Key 字段中。",
      ok: false,
    };
  }
  if (url.search || url.hash) {
    return {
      message: "AI API 地址请填写接口根地址，不要包含查询参数或 # 片段。",
      ok: false,
    };
  }
  return { ok: true, value: url.toString().replace(/\/+$/, "") };
}

function normalizeWebDavBaseUrl(value: string): SettingsUrlValidation {
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

function sameAiSettings(a: AiSettingsSnapshot, b: AiSettingsSnapshot): boolean {
  return (
    a.kind === b.kind && a.baseUrl === b.baseUrl && a.model === b.model && a.apiKey === b.apiKey
  );
}

function sameTranslateSettings(
  a: TranslateSettingsSnapshot,
  b: TranslateSettingsSnapshot,
): boolean {
  return (
    a.engine === b.engine &&
    a.targetLang === b.targetLang &&
    a.deeplKey === b.deeplKey &&
    a.baiduAppid === b.baiduAppid &&
    a.baiduKey === b.baiduKey
  );
}

function sameSyncSettings(a: SyncSettingsSnapshot, b: SyncSettingsSnapshot): boolean {
  return a.baseUrl === b.baseUrl && a.username === b.username && a.password === b.password;
}
