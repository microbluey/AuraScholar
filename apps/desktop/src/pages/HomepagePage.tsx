// Homepage editor: profile form + auto-filled publications from the library
// (sentinel-completed works included automatically) + live preview + export.
import { useCallback, useEffect, useMemo, useState } from "react";
import { renderSite, type Profile, type ProfilePublication } from "@aurascholar/homepage";
import { type WorkWithAuthors } from "@aurascholar/db";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { listWorks } from "../services/library";

const PROFILE_KEY = "homepage-profile";

interface StoredProfile {
  displayName: string;
  tagline: string;
  email: string;
  bioMd: string;
  scholarUrl: string;
  githubUrl: string;
  orcid: string;
  selfName: string;
  theme: string;
  /** work ids chosen for the publication list */
  selectedWorkIds: string[];
}

const EMPTY: StoredProfile = {
  displayName: "",
  tagline: "",
  email: "",
  bioMd: "",
  scholarUrl: "",
  githubUrl: "",
  orcid: "",
  selfName: "",
  theme: "dawn-minimal",
  selectedWorkIds: [],
};

function loadProfile(): StoredProfile {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}") };
  } catch {
    return EMPTY;
  }
}

export function HomepagePage() {
  const [profile, setProfile] = useState<StoredProfile>(loadProfile);
  const [works, setWorks] = useState<WorkWithAuthors[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string>("");

  useEffect(() => {
    void listWorks().then(setWorks);
  }, []);

  useEffect(() => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }, [profile]);

  const set = useCallback(<K extends keyof StoredProfile>(key: K, value: StoredProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }));
  }, []);

  const toggleWork = useCallback((id: string) => {
    setProfile((p) => ({
      ...p,
      selectedWorkIds: p.selectedWorkIds.includes(id)
        ? p.selectedWorkIds.filter((x) => x !== id)
        : [...p.selectedWorkIds, id],
    }));
  }, []);

  const buildProfile = useCallback((): Profile => {
    const selected = works.filter((w) => profile.selectedWorkIds.includes(w.id));
    const publications: ProfilePublication[] = selected
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      .map((w) => ({
        title: w.title,
        authors: w.authorNames,
        venue: w.venue_name ?? undefined,
        year: w.year ?? undefined,
        doi: w.doi ?? undefined,
        selfName: profile.selfName || undefined,
      }));
    const links = [
      { label: "Google Scholar", url: profile.scholarUrl },
      { label: "ORCID", url: profile.orcid ? `https://orcid.org/${profile.orcid}` : "" },
      { label: "GitHub", url: profile.githubUrl },
    ].filter((l) => l.url);
    return {
      displayName: profile.displayName || "未命名",
      tagline: profile.tagline || undefined,
      email: profile.email || undefined,
      bioMd: profile.bioMd || undefined,
      links,
      publications,
      sections: [],
      theme: profile.theme,
    };
  }, [profile, works]);

  const preview = useCallback(() => {
    const site = renderSite(buildProfile());
    setPreviewHtml(site.files.get("index.html") ?? "");
  }, [buildProfile]);

  const exportHtml = useCallback(() => {
    const site = renderSite(buildProfile());
    const blob = new Blob([site.files.get("index.html") ?? ""], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "index.html";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [buildProfile]);

  const fieldLabel = {
    fontSize: 13,
    color: "var(--color-text-muted)",
    display: "block",
    marginBottom: 4,
    marginTop: 12,
  } as const;

  const selectedCount = profile.selectedWorkIds.length;

  return (
    <div>
      <h1 className="app-page-title">学术主页</h1>
      <p className="app-page-subtitle">
        填写个人信息,从文献库勾选成果,一键生成可部署到任何静态托管的主页
      </p>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 380px", maxWidth: 520 }}>
          <Card>
            <h3 className="au-heading" style={{ fontSize: 16, marginBottom: 4 }}>
              基本信息
            </h3>
            <label style={fieldLabel}>姓名</label>
            <Input value={profile.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="王小明" />
            <label style={fieldLabel}>头衔一句话</label>
            <Input value={profile.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="博士研究生 · 某某大学计算机学院" />
            <label style={fieldLabel}>邮箱</label>
            <Input value={profile.email} onChange={(e) => set("email", e.target.value)} placeholder="you@university.edu" />
            <label style={fieldLabel}>简介</label>
            <textarea
              className="au-input"
              rows={3}
              value={profile.bioMd}
              onChange={(e) => set("bioMd", e.target.value)}
              placeholder="研究方向、兴趣…"
              style={{ resize: "vertical", fontFamily: "var(--font-body)" }}
            />
            <label style={fieldLabel}>论文作者名(用于在作者列表中加粗自己)</label>
            <Input value={profile.selfName} onChange={(e) => set("selfName", e.target.value)} placeholder="Xiaoming Wang" />
            <label style={fieldLabel}>Google Scholar 链接</label>
            <Input value={profile.scholarUrl} onChange={(e) => set("scholarUrl", e.target.value)} />
            <label style={fieldLabel}>ORCID</label>
            <Input value={profile.orcid} onChange={(e) => set("orcid", e.target.value)} placeholder="0000-0000-0000-0000" />
            <label style={fieldLabel}>GitHub 链接</label>
            <Input value={profile.githubUrl} onChange={(e) => set("githubUrl", e.target.value)} />
            <label style={fieldLabel}>主页风格</label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant={profile.theme === "dawn-minimal" ? "primary" : "secondary"}
                onClick={() => set("theme", "dawn-minimal")}
              >
                Dawn 学术极简
              </Button>
              <Button
                variant={profile.theme === "nocturne-geek" ? "primary" : "secondary"}
                onClick={() => set("theme", "nocturne-geek")}
              >
                Nocturne 暗色极客
              </Button>
            </div>
          </Card>

          <Card style={{ marginTop: 16 }}>
            <h3 className="au-heading" style={{ fontSize: 16, marginBottom: 8 }}>
              发表论文 <Badge variant="neutral">{selectedCount} 已选</Badge>
            </h3>
            <p className="au-text-muted" style={{ fontSize: 12, marginTop: 0 }}>
              勾选要展示的成果(哨兵监控完成的论文会自动出现在文献库里)
            </p>
            <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {works.map((w) => (
                <label
                  key={w.id}
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={profile.selectedWorkIds.includes(w.id)}
                    onChange={() => toggleWork(w.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    {w.title}
                    {w.year && <span className="au-text-muted"> ({w.year})</span>}
                  </span>
                </label>
              ))}
              {works.length === 0 && (
                <p className="au-text-muted" style={{ fontSize: 13 }}>文献库为空</p>
              )}
            </div>
          </Card>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button onClick={preview}>预览</Button>
            <Button variant="secondary" onClick={exportHtml}>
              导出 index.html
            </Button>
          </div>
          <p className="au-text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            导出的是零依赖单文件 HTML,可直接放到 GitHub Pages、Netlify 或任何服务器。
          </p>
        </div>

        <div style={{ flex: "1 1 480px", minWidth: 360 }}>
          <Card style={{ padding: 8 }}>
            {previewHtml ? (
              <iframe
                title="主页预览"
                srcDoc={previewHtml}
                style={{
                  width: "100%",
                  height: 640,
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  background: "white",
                }}
              />
            ) : (
              <p className="au-text-muted" style={{ padding: 32, textAlign: "center", fontSize: 13 }}>
                点击"预览"查看效果
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
