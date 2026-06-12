import { useState } from "react";
import { Badge, Button, Card, Input, useTheme } from "@aurascholar/ui";
import { loadAiSettings, makeProvider, saveAiSettings } from "../services/ai";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const existing = loadAiSettings();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "https://api.deepseek.com/v1");
  const [model, setModel] = useState(existing?.model ?? "deepseek-chat");
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

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
    </div>
  );
}
