import { useState } from "react";
import { Badge, Button, Card, Input, useTheme } from "@aurascholar/ui";
import { loadAiSettings, makeProvider, saveAiSettings } from "../services/ai";
import {
  exportLibraryJson,
  loadSyncSettings,
  runSync,
  saveSyncSettings,
} from "../services/sync";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const existing = loadAiSettings();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "https://api.deepseek.com/v1");
  const [model, setModel] = useState(existing?.model ?? "deepseek-chat");
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const syncExisting = loadSyncSettings();
  const [davUrl, setDavUrl] = useState(syncExisting?.baseUrl ?? "");
  const [davUser, setDavUser] = useState(syncExisting?.username ?? "");
  const [davPass, setDavPass] = useState(syncExisting?.password ?? "");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    saveSyncSettings({ baseUrl: davUrl.trim(), username: davUser.trim(), password: davPass });
    setSyncing(true);
    setSyncStatus("同步中…");
    try {
      const r = await runSync();
      setSyncStatus(
        `同步完成 ✓ 推送 ${r.pushedEntries} 条 · 拉取 ${r.pulledEntries} 条 · 应用 ${r.appliedEntries} 条` +
          (r.conflicts > 0 ? ` · ${r.conflicts} 个冲突已记录` : ""),
      );
    } catch (e) {
      setSyncStatus(`同步失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    const blob = await exportLibraryJson();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aurascholar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const save = () => {
    saveAiSettings({ baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() });
    setStatus("已保存");
  };

  const test = async () => {
    save();
    setTesting(true);
    setStatus("测试中…");
    try {
      const provider = makeProvider();
      if (!provider) throw new Error("配置不完整");
      const res = await provider.generateText({
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
        maxTokens: 10,
      });
      setStatus(`连接成功 ✓ 模型回复:${res.text.slice(0, 50)}`);
    } catch (e) {
      setStatus(`连接失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const sectionTitle = { fontSize: 16, marginBottom: 12 } as const;
  const fieldLabel = {
    fontSize: 13,
    color: "var(--color-text-muted)",
    display: "block",
    marginBottom: 4,
    marginTop: 12,
  } as const;

  return (
    <div>
      <h1 className="app-page-title">设置</h1>
      <p className="app-page-subtitle">主题、AI 服务与同步配置</p>

      <Card style={{ maxWidth: 640, marginBottom: 24 }}>
        <h3 className="au-heading" style={sectionTitle}>
          外观
        </h3>
        <div style={{ display: "flex", gap: 12 }}>
          <Button
            variant={theme === "dawn" ? "primary" : "secondary"}
            onClick={() => setTheme("dawn")}
          >
            ☀️ Dawn · 学术极简
          </Button>
          <Button
            variant={theme === "nocturne" ? "primary" : "secondary"}
            onClick={() => setTheme("nocturne")}
          >
            🌙 Nocturne · 极客暗黑
          </Button>
        </div>
      </Card>

      <Card style={{ maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 className="au-heading" style={{ ...sectionTitle, marginBottom: 0 }}>
            AI 服务(自带 Key)
          </h3>
          <Badge variant="neutral">OpenAI 兼容</Badge>
        </div>
        <p className="au-text-muted" style={{ fontSize: 13 }}>
          支持任何 OpenAI 兼容端点:DeepSeek、Moonshot、Ollama 本地、各类中转站。Key
          仅保存在本机。
        </p>
        <label style={fieldLabel}>API 地址</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com/v1"
        />
        <label style={fieldLabel}>模型</label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="deepseek-chat"
        />
        <label style={fieldLabel}>API Key</label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
        />
        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
          <Button onClick={save}>保存</Button>
          <Button variant="secondary" onClick={() => void test()} disabled={testing}>
            测试连接
          </Button>
          {status && (
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{status}</span>
          )}
        </div>
      </Card>

      <Card style={{ maxWidth: 640, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 className="au-heading" style={{ ...sectionTitle, marginBottom: 0 }}>
            多设备同步(自带云盘)
          </h3>
          <Badge variant="neutral">WebDAV</Badge>
        </div>
        <p className="au-text-muted" style={{ fontSize: 13 }}>
          支持坚果云、Nextcloud、群晖/威联通 NAS 等任何 WebDAV 服务。数据存在你自己的云盘里。
        </p>
        <label style={fieldLabel}>WebDAV 地址</label>
        <Input
          value={davUrl}
          onChange={(e) => setDavUrl(e.target.value)}
          placeholder="https://dav.jianguoyun.com/dav/AuraScholar"
        />
        <label style={fieldLabel}>用户名</label>
        <Input value={davUser} onChange={(e) => setDavUser(e.target.value)} />
        <label style={fieldLabel}>密码 / 应用密码</label>
        <Input type="password" value={davPass} onChange={(e) => setDavPass(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={() => void handleSync()} disabled={syncing || !davUrl.trim()}>
            {syncing ? "同步中…" : "立即同步"}
          </Button>
          <Button variant="secondary" onClick={() => void handleExport()}>
            导出整库备份(JSON)
          </Button>
        </div>
        {syncStatus && (
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 8, marginBottom: 0 }}>
            {syncStatus}
          </p>
        )}
      </Card>
    </div>
  );
}
