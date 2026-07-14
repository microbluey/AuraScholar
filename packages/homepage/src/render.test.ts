import { describe, expect, it } from "vitest";
import { formatApa, formatGbt7714, type Profile } from "./model";
import { renderSite } from "./render";

const PROFILE: Profile = {
  displayName: "王小明",
  tagline: "博士研究生 · 某大学计算机学院",
  email: "wang@example.edu",
  bioMd: "研究方向为机器学习与系统。",
  links: [
    { label: "Google Scholar", url: "https://scholar.google.com/x" },
    { label: "GitHub", url: "https://github.com/wang" },
  ],
  publications: [
    {
      title: "A Great Paper",
      authors: ["Xiaoming Wang", "Li Hua", "Zhang San", "Li Si"],
      venue: "NeurIPS",
      year: 2025,
      doi: "10.1234/xyz",
      selfName: "Xiaoming Wang",
      tags: ["CCF-A"],
    },
  ],
  sections: [
    {
      kind: "education",
      title: "教育经历",
      items: [{ period: "2021.09 – 至今", headline: "某大学 · 计算机 · 博士", detail: "导师:某教授" }],
    },
  ],
  theme: "dawn-minimal",
};

describe("citation formatting", () => {
  it("GB/T 7714 truncates at 3 authors with 等", () => {
    const line = formatGbt7714(PROFILE.publications[0]!);
    expect(line).toContain("Xiaoming Wang, Li Hua, Zhang San, 等");
    expect(line).toContain("[J]. NeurIPS, 2025.");
  });
  it("APA keeps up to 7 authors", () => {
    const line = formatApa(PROFILE.publications[0]!);
    expect(line).toContain("Li Si");
    expect(line).toContain("(2025).");
  });
});

describe("renderSite", () => {
  it("renders a self-contained dawn page", () => {
    const site = renderSite(PROFILE);
    const html = site.files.get("index.html")!;
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("王小明");
    expect(html).toContain("https://doi.org/10.1234/xyz");
    expect(html).toContain("<strong>Xiaoming Wang</strong>"); // self highlighted
    expect(html).toContain("CCF-A");
    expect(html).toContain("教育经历");
    expect(html).toContain('rel="noopener noreferrer">AuraScholar</a>');
    expect(html).not.toContain("<script"); // truly static
    expect(html).not.toMatch(/src=["']http/); // no external requests
  });

  it("normalizes publication DOI links and omits invalid DOI links", () => {
    const site = renderSite({
      ...PROFILE,
      publications: [
        {
          title: "Normalized DOI Paper",
          authors: ["Wang Xiao"],
          year: 2026,
          doi: " https://DX.doi.org/10.5555/Foo.Bar ",
        },
        {
          title: "Invalid DOI Paper",
          authors: ["Wang Xiao"],
          year: 2026,
          doi: "https://example.com/not-a-doi",
        },
      ],
      sections: [],
    });
    const html = site.files.get("index.html")!;

    expect(html).toContain(
      'href="https://doi.org/10.5555/foo.bar" target="_blank" rel="noopener noreferrer">[DOI]</a>',
    );
    expect(html).not.toContain("https://doi.org/https://");
    expect(html).not.toContain("https://example.com/not-a-doi");
  });

  it("renders the nocturne template when selected", () => {
    const site = renderSite({ ...PROFILE, theme: "nocturne-geek" });
    const html = site.files.get("index.html")!;
    expect(html).toContain("#0a0c10"); // dark bg
    expect(html).toContain("JetBrains Mono");
  });

  it("escapes HTML in user content", () => {
    const site = renderSite({
      ...PROFILE,
      displayName: '<img src=x onerror="alert(1)">',
      publications: [],
      sections: [],
    });
    const html = site.files.get("index.html")!;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("omits unsafe profile links from exported HTML", () => {
    const site = renderSite({
      ...PROFILE,
      email: "",
      links: [
        { label: "Lab", url: "https://example.edu/profile?q=<x>" },
        { label: "Email", url: "mailto:wang@example.edu" },
        { label: "Script", url: "javascript:alert(1)" },
        { label: "Data", url: "data:text/html,<h1>x</h1>" },
        { label: "Credential", url: "https://user:pass@example.edu/profile" },
        { label: "Broken", url: "https://javascript:alert(1)" },
      ],
      publications: [],
      sections: [],
    });
    const html = site.files.get("index.html")!;
    expect(html).toContain(
      'href="https://example.edu/profile?q=%3Cx%3E" target="_blank" rel="noopener noreferrer">Lab</a>',
    );
    expect(html).toContain('href="mailto:wang@example.edu" rel="noopener noreferrer">Email</a>');
    expect(html).not.toContain("Script");
    expect(html).not.toContain("Data");
    expect(html).not.toContain("Credential");
    expect(html).not.toContain("user:pass");
    expect(html).not.toContain("Broken");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
  });

  it("does not add a leading separator when only email is rendered", () => {
    const site = renderSite({
      ...PROFILE,
      email: "wang@example.edu",
      links: [{ label: "Script", url: "javascript:alert(1)" }],
      publications: [],
      sections: [],
    });
    const html = site.files.get("index.html")!;
    expect(html).toContain('<nav class="links"><a href="mailto:wang@example.edu">wang@example.edu</a></nav>');
  });

  it("omits invalid profile email links from exported HTML", () => {
    const site = renderSite({
      ...PROFILE,
      email: 'wang@example.edu?subject="x"',
      links: [{ label: "Script", url: "javascript:alert(1)" }],
      publications: [],
      sections: [],
    });
    const html = site.files.get("index.html")!;

    expect(html).toContain('<nav class="links"></nav>');
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("subject=");
    expect(html).not.toContain('<span class="sep">');
  });

  it("omits empty sections", () => {
    const site = renderSite({ ...PROFILE, publications: [], sections: [] });
    const html = site.files.get("index.html")!;
    expect(html).not.toContain("发表论文");
  });
});
