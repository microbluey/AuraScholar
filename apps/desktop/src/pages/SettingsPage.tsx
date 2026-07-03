import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { TARGET_LANGS, type TranslateEngine } from "@aurascholar/translate";
import { Badge, Button, Card, Input, useTheme } from "@aurascholar/ui";
import { loadAiSettings, makeProvider, saveAiSettings, type AiProviderKind } from "../services/ai";
import {
  clearTranslationCache,
  loadTranslateConfig,
  saveTranslateConfig,
} from "../services/translate";
import { exportLibraryJson, loadSyncSettings, runSync, saveSyncSettings } from "../services/sync";
import { useConfirmDialog, type ConfirmFunction } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { downloadBlob } from "../download";
import { isDesktopRuntime } from "../services/aura-platform";

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

const MIN_SETTINGS_BUSY_MS = 500;


function describeUnknownError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  if (value == null) return "未知错误";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { confirm, confirmDialog } = useConfirmDialog();
  const desktopRuntime = isDesktopRuntime();
  const [aiKind, setAiKind] = useState<AiProviderKind>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiSaving, setAiSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedAiSettings, setSavedAiSettings] = useState<AiSettingsSnapshot>(DEFAULT_AI_SETTINGS);

  const [trEngine, setTrEngine] = useState<TranslateEngine>("llm");
  const [trTarget, setTrTarget] = useState("zh");
  const [deeplKey, setDeeplKey] = useState("");
  const [baiduAppid, setBaiduAppid] = useState("");
  const [baiduKey, setBaiduKey] = useState("");
  const [trStatus, setTrStatus] = useState<string | null>(null);
  const [translateLoading, setTranslateLoading] = useState(true);
  const [translateSaving, setTranslateSaving] = useState(false);
  const [clearingTranslateCache, setClearingTranslateCache] = useState(false);
  const [savedTranslateSettings, setSavedTranslateSettings] = useState<TranslateSettingsSnapshot>(
    DEFAULT_TRANSLATE_SETTINGS,
  );

  const [davUrl, setDavUrl] = useState("");
  const [davUser, setDavUser] = useState("");
  const [davPass, setDavPass] = useState("");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const [savedSyncSettings, setSavedSyncSettings] =
    useState<SyncSettingsSnapshot>(DEFAULT_SYNC_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    void loadAiSettings()
      .then((settings) => {
        if (cancelled) return;
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
      })
      .catch((error) => {
        if (cancelled) return;
        setSavedAiSettings(DEFAULT_AI_SETTINGS);
        setStatus(`读取 AI 配置失败：${describeUnknownError(error)}`);
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });
    void loadTranslateConfig()
      .then((config) => {
        if (cancelled) return;
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
      })
      .catch((error) => {
        if (cancelled) return;
        setSavedTranslateSettings(DEFAULT_TRANSLATE_SETTINGS);
        setTrStatus(`读取翻译配置失败：${describeUnknownError(error)}`);
      })
      .finally(() => {
        if (!cancelled) setTranslateLoading(false);
      });
    void loadSyncSettings()
      .then((settings) => {
        if (cancelled) return;
        if (!settings) {
          setSavedSyncSettings(DEFAULT_SYNC_SETTINGS);
          return;
        }
        const next = makeSyncSettingsSnapshot(
          settings.baseUrl,
          settings.username,
          settings.password,
        );
        setDavUrl(next.baseUrl);
        setDavUser(next.username);
        setDavPass(next.password);
        setSavedSyncSettings(next);
      })
      .catch((error) => {
        if (cancelled) return;
        setSavedSyncSettings(DEFAULT_SYNC_SETTINGS);
        setSyncStatus(`读取同步配置失败：${describeUnknownError(error)}`);
      })
      .finally(() => {
        if (!cancelled) setSyncLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const syncBusy = syncLoading || syncSaving || syncing || exportingBackup;
  const busySections = useMemo(
    () =>
      [
        aiSaving || testing ? "AI 服务" : null,
        translateSaving || clearingTranslateCache ? "阅读翻译" : null,
        syncSaving || syncing || exportingBackup ? "同步与备份" : null,
      ].filter((item): item is string => Boolean(item)),
    [
      aiSaving,
      clearingTranslateCache,
      exportingBackup,
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

  const readinessItems = useMemo(
    () => [
      {
        label: "AI 生成",
        value: aiLoading
          ? "读取中"
          : aiBusy
            ? "处理中"
            : aiDirty
              ? "未保存"
              : aiConfigured
                ? "可用"
                : "待配置",
        detail: aiLoading
          ? "正在读取本机配置"
          : aiSaving
            ? "正在保存配置"
            : testing
              ? "正在测试连接"
              : aiDirty
                ? "保存后生效"
                : aiConfigured
                  ? model.trim()
                  : "需要模型与 API Key",
        tone: aiBusy || aiDirty ? "warning" : aiConfigured ? "ready" : "warning",
      },
      {
        label: "翻译",
        value: translateLoading
          ? "读取中"
          : translateBusy
            ? "处理中"
            : translateDirty
              ? "未保存"
              : translationReady
                ? "可用"
                : "待配置",
        detail: translateLoading
          ? "正在读取本机配置"
          : translateSaving
            ? "正在保存配置"
            : clearingTranslateCache
              ? "正在清除缓存"
              : translateDirty
                ? "保存后生效"
                : trEngine === "llm"
                  ? "复用 AI 服务"
                  : translateEngineLabel(trEngine),
        tone: translateBusy || translateDirty ? "warning" : translationReady ? "ready" : "warning",
      },
      {
        label: "同步",
        value: syncLoading
          ? "读取中"
          : syncBusy
            ? "处理中"
            : syncDirty
              ? "未保存"
              : syncConfigured
                ? "已配置"
                : "可选",
        detail: syncLoading
          ? "正在读取本机配置"
          : syncSaving
            ? "正在保存配置"
            : syncing
              ? "正在同步"
              : exportingBackup
                ? "正在导出备份"
                : syncDirty
                  ? "保存后生效"
                  : syncConfigured
                    ? urlSafeHost(davUrl)
                    : "WebDAV / JSON 备份",
        tone: syncBusy || syncDirty ? "warning" : syncConfigured ? "ready" : "muted",
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
      aiLoading,
      aiSaving,
      clearingTranslateCache,
      davUrl,
      desktopRuntime,
      exportingBackup,
      model,
      syncConfigured,
      syncBusy,
      syncDirty,
      syncLoading,
      syncSaving,
      syncing,
      trEngine,
      translateBusy,
      translateDirty,
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
    if (aiKind !== "anthropic" && !baseUrl.trim()) return "请填写 OpenAI 兼容 API 地址。";
    if (!apiKey.trim()) return "请填写 API Key。本地兼容端点也可以填写占位 Key。";
    if (!desktopRuntime) return "浏览器预览无法保存密钥，请在桌面应用中完成配置。";
    return null;
  };

  const save = async (): Promise<boolean> => {
    if (aiBusy) return false;
    const error = validateAiConfig();
    if (error) {
      setStatus(error);
      return false;
    }
    const next = currentAiSettings;
    setAiSaving(true);
    setStatus("保存中...");
    try {
      await withMinimumBusyTime(saveAiSettings(next));
    } catch (e) {
      setStatus(`保存失败：${e instanceof Error ? e.message : String(e)}`);
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
    setStatus("已保存，新的 AI 配置会用于摘要、闪卡与翻译。");
    return true;
  };

  const test = async () => {
    if (aiBusy) return;
    const saved = await save();
    if (!saved) return;
    setTesting(true);
    setStatus("测试中...");
    try {
      const provider = await makeProvider();
      if (!provider) throw new Error("配置不完整");
      const res = await provider.generateText({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        maxTokens: 10,
      });
      setStatus(`连接成功，模型回复：${res.text.slice(0, 50)}`);
    } catch (e) {
      setStatus(`连接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const saveTranslate = async () => {
    if (translateBusy) return;
    const next = currentTranslateSettings;
    setTranslateSaving(true);
    setTrStatus("保存中...");
    try {
      await withMinimumBusyTime(
        saveTranslateConfig({
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
      setTrStatus(`保存失败：${e instanceof Error ? e.message : String(e)}`);
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
      setTrStatus("浏览器预览无法访问本地翻译缓存。");
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
      setTrStatus(`清除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setClearingTranslateCache(false);
    }
  };

  const saveSyncOnly = async (): Promise<boolean> => {
    if (syncBusy) return false;
    if (!davUrl.trim()) {
      setSyncStatus("请填写 WebDAV 地址。");
      return false;
    }
    if (!davUser.trim() || !davPass.trim()) {
      setSyncStatus("请填写用户名和密码 / 应用密码。");
      return false;
    }
    if (!desktopRuntime) {
      setSyncStatus("浏览器预览无法保存同步密码，请在桌面应用中完成配置。");
      return false;
    }
    const next = currentSyncSettings;
    setSyncSaving(true);
    setSyncStatus("正在保存同步配置...");
    try {
      await withMinimumBusyTime(saveSyncSettings(next));
    } catch (e) {
      setSyncStatus(`保存失败：${e instanceof Error ? e.message : String(e)}`);
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
    setSyncing(true);
    setSyncStatus("同步中...");
    try {
      const r = await runSync();
      setSyncStatus(
        `同步完成：推送 ${r.pushedEntries} 条，拉取 ${r.pulledEntries} 条，应用 ${r.appliedEntries} 条` +
          (r.conflicts > 0 ? `，${r.conflicts} 个冲突已记录` : ""),
      );
    } catch (e) {
      setSyncStatus(`同步失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    if (syncBusy) return;
    if (!desktopRuntime) {
      setSyncStatus("浏览器预览无法导出本地库备份。");
      return;
    }
    setExportingBackup(true);
    setSyncStatus("正在导出整库备份...");
    try {
      const blob = await withMinimumBusyTime(exportLibraryJson());
      const filename = downloadBlob(
        blob,
        `aurascholar-backup-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setSyncStatus(`整库 JSON 备份已导出：${filename}（${formatBytes(blob.size)}）。`);
    } catch (e) {
      setSyncStatus(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingBackup(false);
    }
  };

  return (
    <div className="settings-page settings-page--control">
      <div className="settings-hero">
        <div>
          <p className="app-page-kicker">Local control center</p>
          <h1 className="app-page-title">设置</h1>
          <p className="app-page-subtitle">
            把模型、翻译、同步和备份先调顺，后面的研究流会轻很多。
          </p>
        </div>
        <div className="settings-readiness" aria-label="配置状态">
          {readinessItems.map((item) => (
            <ReadinessItem key={item.label} {...item} />
          ))}
        </div>
      </div>

      {!desktopRuntime && (
        <Card className="settings-preview-note">
          <Badge variant="warning">Preview</Badge>
          <div>
            <strong>当前是浏览器预览环境</strong>
            <p>可以检查布局和文案，但密钥、数据库、同步和连接测试需要在桌面应用中完成。</p>
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
        <Card className="settings-card settings-card--compact">
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

        <Card className="settings-card settings-card--ai">
          <SettingsCardHeader
            title="AI 服务"
            badge={activeProvider.label}
            dirty={aiDirty}
            description="AuraScholar 不内置云端账号，摘要、重点和闪卡都走你自己的模型服务。"
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
                type="password"
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
            <Button onClick={() => void save()} disabled={aiBusy} aria-busy={aiSaving || undefined}>
              {aiSaving ? "保存中..." : "保存 AI 配置"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void test()}
              disabled={aiBusy}
              aria-busy={testing || undefined}
            >
              {testing ? "测试中..." : "测试连接"}
            </Button>
            {aiDirty && (
              <Button variant="ghost" onClick={resetAiChanges} disabled={aiBusy}>
                撤销修改
              </Button>
            )}
          </ActionRow>
        </Card>

        <Card className="settings-card">
          <SettingsCardHeader
            title="阅读翻译"
            badge={translateEngineLabel(trEngine)}
            dirty={translateDirty}
            description="阅读器划词翻译会优先复用缓存，重复段落不会反复消耗额度。"
          />

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
                type="password"
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
                  type="password"
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
              onClick={() => void saveTranslate()}
              disabled={translateBusy}
              aria-busy={translateSaving || undefined}
            >
              {translateSaving ? "保存中..." : "保存翻译配置"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void clearTrCache()}
              disabled={translateBusy}
              aria-busy={clearingTranslateCache || undefined}
            >
              {clearingTranslateCache ? "清除中..." : "清除翻译缓存"}
            </Button>
            {translateDirty && (
              <Button variant="ghost" onClick={resetTranslateChanges} disabled={translateBusy}>
                撤销修改
              </Button>
            )}
          </ActionRow>
        </Card>

        <Card className="settings-card">
          <SettingsCardHeader
            title="同步与备份"
            badge="WebDAV"
            dirty={syncDirty}
            description="多设备同步使用你自己的云盘；完整 JSON 备份可随时导出。"
          />

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
                type="password"
                value={davPass}
                onChange={(e) => {
                  setDavPass(e.target.value);
                  setSyncStatus(null);
                }}
              />
            </Field>
          </div>

          <ActionRow status={syncLoading ? "正在读取同步配置..." : syncStatus}>
            <Button
              variant="secondary"
              onClick={() => void saveSyncOnly()}
              disabled={syncBusy}
              aria-busy={syncSaving || undefined}
            >
              {syncSaving ? "保存中..." : "保存同步配置"}
            </Button>
            <Button onClick={() => void handleSync()} disabled={syncBusy} aria-busy={syncing || undefined}>
              {syncing ? "同步中..." : "立即同步"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleExport()}
              disabled={syncBusy}
              aria-busy={exportingBackup || undefined}
            >
              {exportingBackup ? "导出中..." : "导出整库备份"}
            </Button>
            {syncDirty && (
              <Button variant="ghost" onClick={resetSyncChanges} disabled={syncBusy}>
                撤销修改
              </Button>
            )}
          </ActionRow>
        </Card>
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
      dirtySections.length > 0
        ? "保存后，新的配置才会用于摘要、翻译、同步等流程。"
        : null,
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
