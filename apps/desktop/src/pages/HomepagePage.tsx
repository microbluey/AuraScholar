// Homepage studio: profile editing, publication curation, live static preview,
// and single-file HTML export for academic personal sites.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { renderSite, type Profile, type ProfilePublication } from "@aurascholar/homepage";
import { type WorkWithAuthors } from "@aurascholar/db";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { listWorks } from "../services/library-list";
import { InlineNotice } from "../components/InlineNotice";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { writeClipboardText } from "../clipboard";
import { downloadBlob } from "../download";
import { isStorageRecord, readLocalStorageJson, tryWriteLocalStorageJson } from "../storage";
import { isDesktopRuntime } from "../services/aura-platform";
import { describeSafeError } from "../services/sensitive-text";

const PROFILE_KEY = "homepage-profile";
const FEATURED_LIMIT = 8;
const MIN_PUBLISH_BUSY_MS = 350;

const THEMES = [
  {
    id: "dawn-minimal",
    name: "Dawn",
    tone: "学术极简",
    detail: "白底、长文友好、适合院系主页和 GitHub Pages。",
  },
  {
    id: "nocturne-geek",
    name: "Nocturne",
    tone: "暗色极客",
    detail: "高对比、代码气质、适合个人实验室和技术作品集。",
  },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];
type WorksStatus = "loading" | "ready" | "preview" | "error";

interface StoredProfile {
  displayName: string;
  tagline: string;
  email: string;
  bioMd: string;
  scholarUrl: string;
  githubUrl: string;
  orcid: string;
  selfName: string;
  theme: ThemeId;
  /** work ids chosen for the publication list */
  selectedWorkIds: string[];
}

interface HomepageSelectionUndoState {
  ids: string[];
  message: string;
}

interface HomepageSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__?: number;
  __AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__?: string;
  __AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__?: number;
  __AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__?: string;
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

const PREVIEW_HOMEPAGE_TIMESTAMP = Date.UTC(2026, 6, 1, 10, 0, 0);

const PREVIEW_HOMEPAGE_PROFILE: StoredProfile = {
  displayName: "林知微",
  tagline: "博士候选人 · Human-centered AI",
  email: "zhiwei.lin@example.edu",
  bioMd:
    "我关注可靠的人机协作系统，近期研究结合多模态模型、知识管理和可解释评估，帮助研究者把阅读、实验和写作沉淀成可复用的学术资产。",
  scholarUrl: "scholar.google.com/citations?user=aurascholar-demo",
  githubUrl: "github.com/aurascholar/demo-lab",
  orcid: "0000-0002-1825-0097",
  selfName: "Zhiwei Lin",
  theme: "dawn-minimal",
  selectedWorkIds: ["preview-attention", "preview-alphafold", "preview-scaling-laws"],
};

function previewWork(
  input: {
    abstract: string;
    authors: string[];
    doi?: string;
    id: string;
    starred?: boolean;
    title: string;
    venueName: string;
    year: number;
  },
  index: number,
): WorkWithAuthors {
  const timestamp = PREVIEW_HOMEPAGE_TIMESTAMP - index * 1000 * 60 * 42;
  return {
    abstract: input.abstract,
    accessed_date: null,
    accession_number: null,
    arxiv_id: null,
    authorNames: input.authors,
    call_number: null,
    created_at: timestamp,
    database_name: null,
    deleted_at: null,
    doi: input.doi ?? null,
    edition: null,
    fingerprint: null,
    id: input.id,
    isbn: null,
    issn: null,
    issue: null,
    keywords_json: null,
    label: null,
    language: null,
    notes_md: null,
    number_of_volumes: null,
    openalex_id: null,
    original_title: null,
    pages: null,
    place_published: null,
    pmid: null,
    publication_date: `${input.year}`,
    publisher: null,
    reading_status: index < 3 ? "read" : "reading",
    s2_id: null,
    section: null,
    series_title: null,
    short_title: null,
    starred: input.starred ? 1 : 0,
    title: input.title,
    type: "article-journal",
    updated_at: timestamp,
    url: null,
    venue_name: input.venueName,
    venue_type: "conference",
    volume: null,
    year: input.year,
  };
}

const PREVIEW_HOMEPAGE_WORKS: WorkWithAuthors[] = [
  previewWork(
    {
      abstract:
        "Introduces the Transformer architecture and makes attention the central operation for sequence modeling.",
      authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Zhiwei Lin"],
      doi: "10.5555/3295222.3295349",
      id: "preview-attention",
      starred: true,
      title: "Attention Is All You Need",
      venueName: "NeurIPS",
      year: 2017,
    },
    0,
  ),
  previewWork(
    {
      abstract:
        "Shows how an end-to-end neural system can predict protein structures with high accuracy.",
      authors: ["John Jumper", "Richard Evans", "Alexander Pritzel", "Zhiwei Lin"],
      doi: "10.1038/s41586-021-03819-2",
      id: "preview-alphafold",
      starred: true,
      title: "Highly accurate protein structure prediction with AlphaFold",
      venueName: "Nature",
      year: 2021,
    },
    1,
  ),
  previewWork(
    {
      abstract: "Quantifies how model performance scales with compute, data, and parameter count.",
      authors: ["Jared Kaplan", "Sam McCandlish", "Tom Henighan", "Zhiwei Lin"],
      doi: "10.48550/arXiv.2001.08361",
      id: "preview-scaling-laws",
      title: "Scaling Laws for Neural Language Models",
      venueName: "arXiv",
      year: 2020,
    },
    2,
  ),
  previewWork(
    {
      abstract:
        "Builds a promptable segmentation model and a large segmentation dataset for zero-shot transfer.",
      authors: ["Alexander Kirillov", "Eric Mintun", "Nikhila Ravi", "Zhiwei Lin"],
      doi: "10.48550/arXiv.2304.02643",
      id: "preview-sam",
      title: "Segment Anything",
      venueName: "ICCV",
      year: 2023,
    },
    3,
  ),
];

function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

function hasHomepageDraft(profile: StoredProfile): boolean {
  return Boolean(
    profile.displayName.trim() ||
    profile.tagline.trim() ||
    profile.email.trim() ||
    profile.bioMd.trim() ||
    profile.scholarUrl.trim() ||
    profile.githubUrl.trim() ||
    profile.orcid.trim() ||
    profile.selfName.trim() ||
    profile.selectedWorkIds.length > 0 ||
    profile.theme !== EMPTY.theme,
  );
}

function storedString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function loadProfile(): StoredProfile {
  const parsed = readLocalStorageJson<unknown>(PROFILE_KEY, {});
  if (!isStorageRecord(parsed)) return EMPTY;
  return {
    displayName: storedString(parsed.displayName),
    tagline: storedString(parsed.tagline),
    email: storedString(parsed.email),
    bioMd: storedString(parsed.bioMd),
    scholarUrl: storedString(parsed.scholarUrl),
    githubUrl: storedString(parsed.githubUrl),
    orcid: storedString(parsed.orcid),
    selfName: storedString(parsed.selfName),
    theme: isThemeId(parsed.theme) ? parsed.theme : EMPTY.theme,
    selectedWorkIds: Array.isArray(parsed.selectedWorkIds)
      ? parsed.selectedWorkIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function initialHomepageProfile(): StoredProfile {
  const storedProfile = loadProfile();
  if (!isDesktopRuntime() && !hasHomepageDraft(storedProfile)) {
    return PREVIEW_HOMEPAGE_PROFILE;
  }
  return storedProfile;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeOrcid(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, "")
    .replace(/\s+/g, "");
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "aurascholar-homepage";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

async function waitForHomepageSmokeAfterReadDelay(): Promise<void> {
  const smokeWindow = window as HomepageSmokeWindow;
  const delayMs = smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_DELAY_MS__;
  if (typeof delayMs !== "number" || delayMs <= 0) return;
  smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__ =
    (smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_AFTER_READ_COUNT__ ?? 0) + 1;
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function consumeHomepageSmokeReadFailure(): Error | null {
  const smokeWindow = window as HomepageSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_READ__;
  return new Error(message);
}

function consumeHomepageSmokeProfileSaveFailure(): Error | null {
  const smokeWindow = window as HomepageSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
  if (!message) return null;
  const remaining = smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__;
  if (typeof remaining === "number" && remaining > 0) {
    const nextRemaining = remaining - 1;
    if (nextRemaining > 0) {
      smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__ = nextRemaining;
    } else {
      delete smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_PROFILE_SAVE_COUNT__;
      delete smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
    }
    return new Error(message);
  }
  delete smokeWindow.__AURASCHOLAR_SMOKE_HOMEPAGE_FAIL_NEXT_PROFILE_SAVE__;
  return new Error(message);
}

function persistHomepageProfile(
  nextProfile: StoredProfile,
): { ok: true } | { ok: false; error: string } {
  const smokeFailure = consumeHomepageSmokeProfileSaveFailure();
  if (smokeFailure) return { ok: false, error: describeSafeError(smokeFailure) };
  if (tryWriteLocalStorageJson(PROFILE_KEY, nextProfile)) return { ok: true };
  return {
    ok: false,
    error: "浏览器阻止了主页草稿保存，本次修改只保留在当前页面。",
  };
}

function homepageProfileSaveFailureMessage(detail: string): string {
  return `主页草稿保存失败，当前页面已更新但刷新后可能丢失，可重试或导出当前 HTML:${detail}`;
}

function homepageSelectionSaveFailureMessage(detail: string): string {
  return `主页成果已更新但草稿保存失败，撤销入口已保留，可重新调整或导出当前 HTML:${detail}`;
}

function workSearchText(work: WorkWithAuthors): string {
  return [work.title, work.venue_name, work.year?.toString(), work.doi, work.authorNames.join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function publicationFromWork(work: WorkWithAuthors, selfName: string): ProfilePublication {
  return {
    title: work.title,
    authors: work.authorNames,
    venue: work.venue_name ?? undefined,
    year: work.year ?? undefined,
    doi: work.doi ?? undefined,
    selfName: selfName || undefined,
  };
}

function sortWorksForHomepage(a: WorkWithAuthors, b: WorkWithAuthors): number {
  return (
    (b.starred ?? 0) - (a.starred ?? 0) ||
    (b.year ?? 0) - (a.year ?? 0) ||
    b.created_at - a.created_at ||
    a.title.localeCompare(b.title)
  );
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

export function HomepagePage() {
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [profile, setProfileState] = useState<StoredProfile>(() => initialHomepageProfile());
  const [works, setWorks] = useState<WorkWithAuthors[]>([]);
  const [worksStatus, setWorksStatus] = useState<WorksStatus>("loading");
  const [worksError, setWorksError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);
  const [copyingHtml, setCopyingHtml] = useState(false);
  const [profileSaveRetry, setProfileSaveRetry] = useState<StoredProfile | null>(null);
  const [profileSaveRetryBusy, setProfileSaveRetryBusy] = useState(false);
  const [selectionUndo, setSelectionUndo] = useState<HomepageSelectionUndoState | null>(null);
  const [selectionUndoBusy, setSelectionUndoBusy] = useState(false);
  const publicationSearchInputRef = useRef<HTMLInputElement | null>(null);
  const profileRef = useRef(profile);
  const worksLoadSeqRef = useRef(0);

  const refreshWorks = useCallback(async () => {
    const seq = worksLoadSeqRef.current + 1;
    worksLoadSeqRef.current = seq;
    if (!isDesktopRuntime()) {
      if (worksLoadSeqRef.current !== seq) return;
      setWorks(PREVIEW_HOMEPAGE_WORKS);
      setWorksStatus("preview");
      setWorksError(null);
      setMessage(
        (current) =>
          current ||
          "浏览器预览正在展示可发布的学术主页样例；真实成果会在桌面应用中读取本地文献库。",
      );
      return;
    }

    setWorksStatus("loading");
    setWorksError(null);
    try {
      const smokeFailure = consumeHomepageSmokeReadFailure();
      if (smokeFailure) throw smokeFailure;
      const rows = await listWorks(undefined, undefined, 500);
      await waitForHomepageSmokeAfterReadDelay();
      if (worksLoadSeqRef.current !== seq) return;
      setWorks(rows);
      setWorksError(null);
      setWorksStatus("ready");
    } catch (error) {
      if (worksLoadSeqRef.current !== seq) return;
      const errorMessage = describeSafeError(error) || "文献库读取失败。";
      setWorksStatus("error");
      setWorksError(errorMessage);
      setMessage(errorMessage);
    }
  }, []);

  useEffect(() => {
    const refreshId = window.setTimeout(() => {
      void refreshWorks();
    }, 0);
    const onLibraryUpdated = () => void refreshWorks();
    window.addEventListener("aurascholar:library-updated", onLibraryUpdated);
    return () => {
      window.clearTimeout(refreshId);
      worksLoadSeqRef.current += 1;
      window.removeEventListener("aurascholar:library-updated", onLibraryUpdated);
    };
  }, [refreshWorks]);

  const applyProfile = useCallback(
    (
      nextProfile: StoredProfile,
      options: {
        failureMessage?: (detail: string) => string;
        successMessage?: string;
      } = {},
    ): boolean => {
      profileRef.current = nextProfile;
      setProfileState(nextProfile);
      const result = persistHomepageProfile(nextProfile);
      if (result.ok) {
        setSavedAt(Date.now());
        setProfileSaveRetry(null);
        if (options.successMessage) setMessage(options.successMessage);
        return true;
      }
      setProfileSaveRetry(nextProfile);
      setMessage(
        options.failureMessage?.(result.error) ?? homepageProfileSaveFailureMessage(result.error),
      );
      return false;
    },
    [],
  );

  const updateProfile = useCallback(
    <K extends keyof StoredProfile>(key: K, value: StoredProfile[K]) => {
      applyProfile({ ...profileRef.current, [key]: value });
    },
    [applyProfile],
  );

  const selectedIds = useMemo(() => new Set(profile.selectedWorkIds), [profile.selectedWorkIds]);

  const selectedWorks = useMemo(
    () => works.filter((work) => selectedIds.has(work.id)).sort(sortWorksForHomepage),
    [selectedIds, works],
  );

  const visibleWorks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return works
      .filter((work) => (selectedOnly ? selectedIds.has(work.id) : true))
      .filter((work) => (needle ? workSearchText(work).includes(needle) : true))
      .sort(sortWorksForHomepage);
  }, [query, selectedIds, selectedOnly, works]);

  const homepageProfile = useMemo<Profile>(() => {
    const orcid = normalizeOrcid(profile.orcid);
    const links = [
      { label: "Google Scholar", url: normalizeUrl(profile.scholarUrl) },
      { label: "ORCID", url: orcid ? `https://orcid.org/${orcid}` : "" },
      { label: "GitHub", url: normalizeUrl(profile.githubUrl) },
    ].filter((link) => link.url);

    return {
      displayName: profile.displayName.trim() || "未命名学者",
      tagline: profile.tagline.trim() || undefined,
      email: profile.email.trim() || undefined,
      bioMd: profile.bioMd.trim() || undefined,
      links,
      publications: selectedWorks.map((work) => publicationFromWork(work, profile.selfName.trim())),
      sections: [],
      theme: profile.theme,
    };
  }, [profile, selectedWorks]);

  const previewHtml = useMemo(() => {
    const site = renderSite(homepageProfile);
    return site.files.get("index.html") ?? "";
  }, [homepageProfile]);

  const htmlSize = useMemo(() => formatBytes(new Blob([previewHtml]).size), [previewHtml]);

  const readiness = useMemo(
    () => [
      {
        label: "身份",
        ready: Boolean(profile.displayName.trim() && profile.tagline.trim()),
        detail: profile.displayName.trim() || "姓名待填写",
      },
      {
        label: "联系",
        ready: Boolean(profile.email.trim() || homepageProfile.links.length),
        detail: profile.email.trim() || homepageProfile.links[0]?.url || "至少保留一个公开入口",
      },
      {
        label: "简介",
        ready: profile.bioMd.trim().length >= 24,
        detail: profile.bioMd.trim() ? `${profile.bioMd.trim().length} 字` : "研究方向待填写",
      },
      {
        label: "成果",
        ready: selectedWorks.length > 0,
        detail: `${selectedWorks.length} 篇已展示`,
      },
    ],
    [homepageProfile.links, profile, selectedWorks.length],
  );

  const readinessScore = useMemo(() => {
    const done = readiness.filter((item) => item.ready).length;
    return Math.round((done / readiness.length) * 100);
  }, [readiness]);

  const savedLabel = useMemo(() => {
    if (!savedAt) return "自动保存待命";
    return `已自动保存 ${new Date(savedAt).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }, [savedAt]);

  const toggleWork = useCallback(
    (id: string) => {
      setSelectionUndo(null);
      const current = profileRef.current;
      applyProfile({
        ...current,
        selectedWorkIds: current.selectedWorkIds.includes(id)
          ? current.selectedWorkIds.filter((workId) => workId !== id)
          : [...current.selectedWorkIds, id],
      });
    },
    [applyProfile],
  );

  const selectFeaturedWorks = useCallback(async () => {
    const featured = [...works].sort(sortWorksForHomepage).slice(0, FEATURED_LIMIT);
    const featuredIds = featured.map((work) => work.id);
    const willReplaceSelection =
      profile.selectedWorkIds.length > 0 && !sameIdSet(profile.selectedWorkIds, featuredIds);
    if (willReplaceSelection) {
      const confirmed = await confirm({
        cancelLabel: "继续手动选择",
        confirmLabel: "使用精选",
        description: `这会用系统精选的 ${featuredIds.length} 篇成果覆盖你当前手动选择的 ${selectedWorks.length} 篇。`,
        details: [
          "文献库中的论文不会被删除。",
          "主页草稿会自动保存；之后仍可逐篇勾选调整展示列表。",
        ],
        title: "用精选成果覆盖当前选择？",
        tone: "warning",
      });
      if (!confirmed) {
        setMessage("已保留手动选择的主页成果。");
        return;
      }
    }
    const current = profileRef.current;
    const previousIds = current.selectedWorkIds;
    const messageText = featured.length
      ? `已精选 ${featured.length} 篇成果。`
      : "文献库暂无可展示成果。";
    if (!sameIdSet(previousIds, featuredIds)) {
      setSelectionUndo({ ids: previousIds, message: messageText });
    } else {
      setSelectionUndo(null);
    }
    applyProfile(
      { ...current, selectedWorkIds: featuredIds },
      { failureMessage: homepageSelectionSaveFailureMessage, successMessage: messageText },
    );
    setSelectedOnly(false);
  }, [applyProfile, confirm, profile.selectedWorkIds, selectedWorks.length, works]);

  const clearSelectedWorks = useCallback(async () => {
    if (selectedWorks.length === 0) return;
    const current = profileRef.current;
    const previousIds = current.selectedWorkIds;
    const confirmed = await confirm({
      cancelLabel: "继续保留",
      confirmLabel: "清空列表",
      description: `这会从你的公开主页草稿中移除已选择的 ${selectedWorks.length} 篇成果。`,
      details: ["文献库中的论文不会被删除。", "主页草稿会自动保存；清空后需要重新选择展示成果。"],
      title: "清空主页成果列表？",
      tone: "warning",
    });
    if (!confirmed) {
      setMessage("已保留主页成果列表。");
      return;
    }
    const successMessage = "已清空主页成果列表。";
    setSelectionUndo({ ids: previousIds, message: successMessage });
    applyProfile(
      { ...current, selectedWorkIds: [] },
      { failureMessage: homepageSelectionSaveFailureMessage, successMessage },
    );
    setSelectedOnly(false);
  }, [applyProfile, confirm, selectedWorks.length]);

  const restoreSelectionUndo = useCallback(async () => {
    if (!selectionUndo || selectionUndoBusy) return;
    const startedAt = Date.now();
    setSelectionUndoBusy(true);
    setMessage("正在撤销主页成果修改...");
    try {
      const nextProfile = { ...profileRef.current, selectedWorkIds: selectionUndo.ids };
      profileRef.current = nextProfile;
      setProfileState(nextProfile);
      const result = persistHomepageProfile(nextProfile);
      if (result.ok) setSavedAt(Date.now());
      setSelectedOnly(false);
      await waitForMinimumElapsed(startedAt, MIN_PUBLISH_BUSY_MS);
      if (!result.ok) {
        setMessage(
          `撤销主页成果修改失败，当前页面已恢复但草稿保存失败，撤销入口仍保留，可重新撤销:${result.error}`,
        );
        return;
      }
      setSelectionUndo(null);
      setMessage("已撤销主页成果修改。");
    } finally {
      setSelectionUndoBusy(false);
    }
  }, [selectionUndo, selectionUndoBusy]);

  const retryProfileSave = useCallback(async () => {
    if (profileSaveRetryBusy) return;
    const nextProfile = profileSaveRetry ?? profileRef.current;
    const startedAt = Date.now();
    setProfileSaveRetryBusy(true);
    setMessage("正在保存主页草稿...");
    try {
      const result = persistHomepageProfile(nextProfile);
      await waitForMinimumElapsed(startedAt, MIN_PUBLISH_BUSY_MS);
      if (result.ok) {
        setSavedAt(Date.now());
        setProfileSaveRetry(null);
        setMessage("主页草稿已保存。");
        return;
      }
      setProfileSaveRetry(nextProfile);
      setMessage(homepageProfileSaveFailureMessage(result.error));
    } finally {
      setProfileSaveRetryBusy(false);
    }
  }, [profileSaveRetry, profileSaveRetryBusy]);

  const clearPublicationFilters = useCallback(() => {
    setQuery("");
    setSelectedOnly(false);
    setMessage("已显示全部可展示成果。");
    const focusSearch = () => {
      publicationSearchInputRef.current?.focus();
    };
    window.requestAnimationFrame(focusSearch);
    window.setTimeout(focusSearch, 0);
  }, []);

  const copyHtml = useCallback(async () => {
    if (copyingHtml || exportingHtml) return;
    const startedAt = Date.now();
    setCopyingHtml(true);
    setMessage("正在复制主页源码...");
    try {
      await writeClipboardText(previewHtml);
      await waitForMinimumElapsed(startedAt, MIN_PUBLISH_BUSY_MS);
      setMessage(`主页 HTML 已复制到剪贴板（${htmlSize}）。`);
    } catch (e) {
      setMessage(`复制失败：${describeSafeError(e)}。请使用导出 HTML。`);
    } finally {
      setCopyingHtml(false);
    }
  }, [copyingHtml, exportingHtml, htmlSize, previewHtml]);

  const exportHtml = useCallback(async () => {
    if (exportingHtml || copyingHtml) return;
    const startedAt = Date.now();
    setExportingHtml(true);
    setMessage("正在导出主页 HTML...");
    try {
      const blob = new Blob([previewHtml], { type: "text/html;charset=utf-8" });
      const filename = downloadBlob(blob, `${slugify(profile.displayName)}-index.html`);
      await waitForMinimumElapsed(startedAt, MIN_PUBLISH_BUSY_MS);
      setMessage(`已导出 ${filename}（${formatBytes(blob.size)}）。`);
    } catch (e) {
      setMessage(`导出失败：${describeSafeError(e)}`);
    } finally {
      setExportingHtml(false);
    }
  }, [copyingHtml, exportingHtml, previewHtml, profile.displayName]);

  const importFromLibrary = useCallback(() => {
    navigate("/library");
  }, [navigate]);

  const showSelectionUndoNotice =
    selectionUndo !== null &&
    (message === selectionUndo.message ||
      selectionUndoBusy ||
      message.startsWith("主页成果已更新但草稿保存失败") ||
      message.startsWith("撤销主页成果修改失败"));
  const selectionUndoNoticeTone = message.includes("失败") ? "warning" : "success";
  const showProfileSaveRetryNotice =
    !showSelectionUndoNotice &&
    Boolean(profileSaveRetry) &&
    (profileSaveRetryBusy || message.startsWith("主页草稿保存失败"));
  const profileSaveRetryNoticeTone = profileSaveRetryBusy ? "busy" : "danger";

  return (
    <main className="homepage-page homepage-page--studio">
      <section className="homepage-hero">
        <div>
          <p className="app-page-kicker">Publish</p>
          <h1 className="app-page-title">学术主页</h1>
          <p className="app-page-subtitle">
            把个人简介、精选成果和学术链接整理成可直接部署的静态主页。
          </p>
        </div>
        <div className="homepage-summary" aria-label="主页发布状态">
          <span className="homepage-summary__item homepage-summary__item--score">
            <strong>{readinessScore}%</strong>
            <small>发布就绪</small>
          </span>
          <span className="homepage-summary__item">
            <strong>{selectedWorks.length}</strong>
            <small>展示成果</small>
          </span>
          <span className="homepage-summary__item">
            <strong>{htmlSize}</strong>
            <small>单文件体积</small>
          </span>
        </div>
      </section>

      {showSelectionUndoNotice && selectionUndo ? (
        <InlineNotice className="homepage-status" message={message} tone={selectionUndoNoticeTone}>
          <span className="homepage-status__text">{message}</span>
          <button
            type="button"
            className="homepage-status__action"
            onClick={() => void restoreSelectionUndo()}
            disabled={selectionUndoBusy}
            aria-busy={selectionUndoBusy ? "true" : undefined}
            aria-label="撤销主页成果修改"
          >
            {selectionUndoBusy ? "撤销中" : "撤销"}
          </button>
        </InlineNotice>
      ) : showProfileSaveRetryNotice ? (
        <InlineNotice
          className="homepage-status"
          message={message}
          tone={profileSaveRetryNoticeTone}
        >
          <span className="homepage-status__text">{message}</span>
          <button
            type="button"
            className="homepage-status__action"
            onClick={() => void retryProfileSave()}
            disabled={profileSaveRetryBusy}
            aria-busy={profileSaveRetryBusy ? "true" : undefined}
            aria-label="重试保存主页草稿"
          >
            {profileSaveRetryBusy ? "保存中" : "重试保存"}
          </button>
        </InlineNotice>
      ) : (
        <InlineNotice className="homepage-status" message={message || savedLabel} />
      )}

      <div className="homepage-layout">
        <div className="homepage-editor-stack">
          <Card className="homepage-card homepage-card--identity">
            <div className="homepage-card__head">
              <div>
                <h2>公开身份</h2>
                <p>这些内容会出现在主页首屏和页面标题中。</p>
              </div>
              <Badge variant={profile.displayName.trim() ? "success" : "warning"}>
                {profile.displayName.trim() ? "已命名" : "待完善"}
              </Badge>
            </div>

            <div className="homepage-form-grid">
              <label className="homepage-field">
                <span>姓名</span>
                <Input
                  value={profile.displayName}
                  onChange={(event) => updateProfile("displayName", event.target.value)}
                  placeholder="王小明"
                />
              </label>
              <label className="homepage-field">
                <span>头衔</span>
                <Input
                  value={profile.tagline}
                  onChange={(event) => updateProfile("tagline", event.target.value)}
                  placeholder="博士研究生 · 计算机学院"
                />
              </label>
              <label className="homepage-field">
                <span>邮箱</span>
                <Input
                  type="email"
                  value={profile.email}
                  onChange={(event) => updateProfile("email", event.target.value)}
                  placeholder="you@university.edu"
                />
              </label>
              <label className="homepage-field">
                <span>论文作者名</span>
                <Input
                  value={profile.selfName}
                  onChange={(event) => updateProfile("selfName", event.target.value)}
                  placeholder="Xiaoming Wang"
                />
                <small>用于在成果作者列表中高亮自己。</small>
              </label>
              <label className="homepage-field homepage-field--wide">
                <span>简介</span>
                <textarea
                  className="au-input homepage-textarea"
                  rows={5}
                  value={profile.bioMd}
                  onChange={(event) => updateProfile("bioMd", event.target.value)}
                  placeholder="研究方向、近期兴趣、实验室或项目经历。"
                />
              </label>
            </div>
          </Card>

          <Card className="homepage-card">
            <div className="homepage-card__head">
              <div>
                <h2>学术链接与风格</h2>
                <p>链接会自动补全协议，ORCID 可直接粘贴编号或完整地址。</p>
              </div>
              <Badge variant="neutral">
                {THEMES.find((theme) => theme.id === profile.theme)?.name}
              </Badge>
            </div>

            <div className="homepage-form-grid">
              <label className="homepage-field">
                <span>Google Scholar</span>
                <Input
                  value={profile.scholarUrl}
                  onChange={(event) => updateProfile("scholarUrl", event.target.value)}
                  placeholder="scholar.google.com/citations?user=..."
                />
              </label>
              <label className="homepage-field">
                <span>ORCID</span>
                <Input
                  value={profile.orcid}
                  onChange={(event) => updateProfile("orcid", event.target.value)}
                  placeholder="0000-0000-0000-0000"
                />
              </label>
              <label className="homepage-field">
                <span>GitHub</span>
                <Input
                  value={profile.githubUrl}
                  onChange={(event) => updateProfile("githubUrl", event.target.value)}
                  placeholder="github.com/your-name"
                />
              </label>
            </div>

            <div className="homepage-theme-grid" role="radiogroup" aria-label="主页风格">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={
                    profile.theme === theme.id
                      ? "homepage-theme-option homepage-theme-option--active"
                      : "homepage-theme-option"
                  }
                  onClick={() => updateProfile("theme", theme.id)}
                  role="radio"
                  aria-checked={profile.theme === theme.id}
                >
                  <span>
                    <strong>{theme.name}</strong>
                    <small>{theme.tone}</small>
                  </span>
                  <em>{theme.detail}</em>
                </button>
              ))}
            </div>
          </Card>

          <Card className="homepage-card homepage-card--publications">
            <div className="homepage-card__head">
              <div>
                <h2>展示成果</h2>
                <p>从文献库选择论文，星标和新近年份会在精选时优先。</p>
              </div>
              <Badge variant={selectedWorks.length ? "success" : "warning"}>
                {selectedWorks.length} 已选
              </Badge>
            </div>

            <div className="homepage-publication-toolbar">
              <input
                ref={publicationSearchInputRef}
                className="au-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、作者、年份、DOI"
                aria-label="搜索可展示成果"
              />
              <button
                type="button"
                className={
                  selectedOnly ? "homepage-toggle homepage-toggle--active" : "homepage-toggle"
                }
                onClick={() => setSelectedOnly((current) => !current)}
              >
                只看已选
              </button>
              <Button
                variant="secondary"
                onClick={() => void selectFeaturedWorks()}
                disabled={works.length === 0}
              >
                精选成果
              </Button>
              <Button
                variant="ghost"
                onClick={() => void clearSelectedWorks()}
                disabled={selectedWorks.length === 0}
              >
                清空
              </Button>
            </div>

            <div className="homepage-publication-list" aria-live="polite">
              {worksStatus === "loading" && (
                <p className="homepage-publication-empty">正在读取文献库...</p>
              )}
              {worksStatus === "error" && (
                <div className="homepage-publication-empty homepage-publication-empty--error">
                  <strong>文献库暂时不可用</strong>
                  <span>
                    {worksError ?? "主页资料和预览仍可编辑，恢复后可以继续选择展示成果。"}
                  </span>
                  <div className="homepage-publication-empty__actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void refreshWorks()}
                      aria-label="重试读取主页文献库"
                    >
                      重试读取
                    </Button>
                    <Button type="button" variant="ghost" onClick={importFromLibrary}>
                      去文献库
                    </Button>
                  </div>
                </div>
              )}
              {worksStatus === "preview" && works.length === 0 && (
                <div className="homepage-publication-empty">
                  <strong>浏览器预览模式</strong>
                  <span>桌面应用会在这里显示本地文献库，当前可先完成资料和导出样式。</span>
                </div>
              )}
              {worksStatus === "ready" && works.length === 0 && (
                <div className="homepage-publication-empty">
                  <strong>文献库还没有成果</strong>
                  <span>先导入论文，之后可以一键生成精选成果列表。</span>
                  <Button variant="secondary" onClick={importFromLibrary}>
                    去文献库
                  </Button>
                </div>
              )}
              {(worksStatus === "ready" || worksStatus === "preview") &&
                works.length > 0 &&
                visibleWorks.length === 0 && (
                  <div className="homepage-publication-empty">
                    <strong>没有匹配的成果</strong>
                    <span>当前搜索或“只看已选”筛选没有命中，公开主页草稿不会被修改。</span>
                    <div className="homepage-publication-empty__actions">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={clearPublicationFilters}
                        aria-label="清空主页成果筛选"
                      >
                        查看全部成果
                      </Button>
                    </div>
                  </div>
                )}
              {visibleWorks.map((work) => {
                const checked = selectedIds.has(work.id);
                return (
                  <label
                    key={work.id}
                    className={
                      checked
                        ? "homepage-publication-row homepage-publication-row--selected"
                        : "homepage-publication-row"
                    }
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleWork(work.id)} />
                    <span>
                      <strong>{work.title}</strong>
                      <small>
                        {work.authorNames.slice(0, 4).join(", ") || "无作者"}
                        {work.year ? ` · ${work.year}` : ""}
                        {work.venue_name ? ` · ${work.venue_name}` : ""}
                      </small>
                    </span>
                    {work.starred ? <Badge variant="accent">星标</Badge> : null}
                  </label>
                );
              })}
            </div>
          </Card>
        </div>

        <aside className="homepage-preview-column">
          <Card className="homepage-preview-card">
            <div className="homepage-card__head homepage-card__head--preview">
              <div>
                <h2>实时预览</h2>
                <p>
                  {homepageProfile.displayName} · {selectedWorks.length} 篇成果
                </p>
              </div>
              <Badge variant={profile.theme === "dawn-minimal" ? "neutral" : "accent"}>
                {profile.theme === "dawn-minimal" ? "Dawn" : "Nocturne"}
              </Badge>
            </div>
            <div className="homepage-preview-frame">
              <iframe title="主页实时预览" srcDoc={previewHtml} />
            </div>
          </Card>

          <Card className="homepage-publish-card">
            <div className="homepage-card__head">
              <div>
                <h2>发布检查</h2>
                <p>导出内容不依赖云端服务，也不会包含本地数据库。</p>
              </div>
              <Badge variant={readinessScore >= 75 ? "success" : "warning"}>
                {readinessScore}%
              </Badge>
            </div>

            <div className="homepage-readiness-list">
              {readiness.map((item) => (
                <span
                  key={item.label}
                  className={
                    item.ready
                      ? "homepage-readiness-item homepage-readiness-item--ready"
                      : "homepage-readiness-item"
                  }
                >
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              ))}
            </div>

            <div className="homepage-publish-actions">
              <Button
                onClick={() => void exportHtml()}
                disabled={exportingHtml || copyingHtml}
                aria-busy={exportingHtml || undefined}
              >
                {exportingHtml ? "导出中..." : "导出 HTML"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void copyHtml()}
                disabled={exportingHtml || copyingHtml}
                aria-busy={copyingHtml || undefined}
              >
                {copyingHtml ? "复制中..." : "复制源码"}
              </Button>
            </div>
            <p className="homepage-export-note">
              文件名会使用姓名生成，上传到任意静态托管即可公开访问。
            </p>
          </Card>
        </aside>
      </div>
      {confirmDialog}
    </main>
  );
}
