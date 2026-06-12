// Side-by-side dual-theme component gallery — the visual front door of the
// design system. Each theme renders in its own scoped [data-theme] container.
import type { ReactNode } from "react";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { themeNames, themes, type ThemeName } from "@aurascholar/tokens";

const THEME_TITLE: Record<string, string> = {
  dawn: "☀️ Dawn · 学术极简",
  nocturne: "🌙 Nocturne · 极客暗黑",
};

export function Gallery() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {themeNames.map((name) => (
        <ThemePane key={name} theme={name} />
      ))}
    </div>
  );
}

function ThemePane({ theme }: { theme: ThemeName }) {
  return (
    <div
      data-theme={theme}
      style={{
        flex: 1,
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: 32,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: 0 }}>
        {THEME_TITLE[theme] ?? theme}
      </h1>

      <Section title="按钮">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button>主要操作</Button>
          <Button variant="secondary">次要操作</Button>
          <Button variant="ghost">幽灵按钮</Button>
          <Button variant="danger">危险操作</Button>
          <Button disabled>禁用</Button>
        </div>
      </Section>

      <Section title="输入框">
        <Input placeholder="粘贴 DOI / arXiv ID / 论文链接…" style={{ maxWidth: 360 }} />
      </Section>

      <Section title="徽章">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge>AI</Badge>
          <Badge variant="neutral">2024</Badge>
          <Badge variant="success">已收录</Badge>
          <Badge variant="warning">监控中</Badge>
        </div>
      </Section>

      <Section title="卡片">
        <Card style={{ maxWidth: 420 }}>
          <strong style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}>
            Attention Is All You Need
          </strong>
          <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
            Vaswani, Shazeer, Parmar 等 · NeurIPS · 2017
          </p>
        </Card>
      </Section>

      <Section title="色板">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(
            [
              "color-bg",
              "color-surface-raised",
              "color-border",
              "color-text",
              "color-text-muted",
              "color-accent",
              "color-danger",
              "color-warning",
              "color-success",
            ] as const
          ).map((token) => (
            <div key={token} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 56,
                  height: 36,
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--color-border)",
                  background: `var(--${token})`,
                }}
              />
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", marginTop: 2, color: "var(--color-text-muted)" }}>
                {token.replace("color-", "")}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="令牌值(生成自 tokens 包)">
        <pre
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-muted)",
            background: "var(--color-surface-sunken)",
            padding: 12,
            borderRadius: "var(--radius-card)",
            overflow: "auto",
            maxHeight: 160,
            margin: 0,
          }}
        >
          {JSON.stringify(themes[theme], null, 1)}
        </pre>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2
        style={{
          fontSize: 13,
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: 1,
          margin: "0 0 10px",
          fontFamily: "var(--font-body)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}
