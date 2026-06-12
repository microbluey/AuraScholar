import { Card, useTheme, Button } from "@aurascholar/ui";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <h1 className="app-page-title">设置</h1>
      <p className="app-page-subtitle">主题、数据存储、AI 服务与同步配置</p>
      <Card style={{ maxWidth: 640 }}>
        <h3 className="au-heading" style={{ fontSize: 16, marginBottom: 12 }}>
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
    </div>
  );
}
