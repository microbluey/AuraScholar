import { BookOpenText, FilePdf, MagnifyingGlass, Plus, Quotes, X } from "@phosphor-icons/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@aurascholar/ui";
import { useConfirmDialog } from "../../components/ConfirmDialog";
import { InlineNotice } from "../../components/InlineNotice";
import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import type { KnowledgeSearchOpenOptions } from "../library/KnowledgeSearchPanel";
import type { ResearchProjectService } from "../../services/research-project-service";
import {
  evidenceShelfService,
  evidenceShelfPreviewHasRedaction,
  evidenceShelfSourceIdentityKey,
  evidenceShelfSourceKey,
  previewEvidenceShelfService,
  type EvidenceShelfItem,
  type EvidenceShelfService,
} from "../../services/evidence-shelf";
import type {
  ResearchProjectBusyAction,
  ResearchProjectSource,
  ResearchProjectSummary,
} from "./model";
import { ProjectSourceList } from "./ProjectSourceList";
import { ProjectSourcePicker } from "./ProjectSourcePicker";
import { ResearchProjectSwitcher } from "./ResearchProjectSwitcher";
import { KnowledgeSearchPanel } from "../library/KnowledgeSearchPanel";
import { EvidenceShelfPanel } from "./EvidenceShelfPanel";

const EMPTY_SHELF_IDS: ReadonlySet<string> = new Set();

export interface ResearchProjectWorkspaceProps {
  busyAction: ResearchProjectBusyAction | null;
  error: string | null;
  message: string | null;
  onAddWorks(workIds: readonly string[]): Promise<boolean>;
  onCreate(name: string): Promise<boolean>;
  onDismissFeedback(): void;
  onOpenSource(workId: string): void;
  onOpenKnowledgeResult(
    result: KnowledgeContentSearchResult,
    options: KnowledgeSearchOpenOptions,
  ): Promise<void>;
  shelfService?: EvidenceShelfService;
  onRemoveWork(workId: string): Promise<boolean>;
  onRename(name: string): Promise<boolean>;
  onSelect(projectId: string): void;
  previewMode: boolean;
  project: ResearchProjectSummary;
  projects: readonly ResearchProjectSummary[];
  service: ResearchProjectService;
  sources: readonly ResearchProjectSource[];
}

export function ResearchProjectWorkspace({
  busyAction,
  error,
  message,
  onAddWorks,
  onCreate,
  onDismissFeedback,
  onOpenSource,
  onOpenKnowledgeResult,
  onRemoveWork,
  onRename,
  onSelect,
  previewMode,
  project,
  projects,
  service,
  sources,
  shelfService,
}: ResearchProjectWorkspaceProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [shelfRefreshToken, setShelfRefreshToken] = useState(0);
  const [shelfMembership, setShelfMembership] = useState<{
    identityFallbackKeys: Set<string>;
    ids: Set<string>;
    sourceKeys: Set<string>;
    projectId: string;
  }>(() => ({
    identityFallbackKeys: new Set(),
    ids: new Set(),
    projectId: project.id,
    sourceKeys: new Set(),
  }));
  const { confirm, confirmDialog } = useConfirmDialog();
  const busy = busyAction !== null;
  // Keep the Shelf adapter aligned with the owning workspace mode when a
  // caller does not inject one explicitly. This matters in browser preview
  // where a test/app shell may still expose a partial `window.aura` bridge:
  // preview must never accidentally reach the persistence IPC commands.
  const activeShelfService =
    shelfService ?? (previewMode ? previewEvidenceShelfService : evidenceShelfService);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSources = useMemo(() => {
    if (!normalizedQuery) return sources;
    return sources.filter((source) =>
      [source.title, source.venue ?? "", source.year?.toString() ?? "", ...source.authorNames].some(
        (value) => value.toLocaleLowerCase().includes(normalizedQuery),
      ),
    );
  }, [normalizedQuery, sources]);
  const pdfCount = sources.filter((source) => source.pdfCount > 0).length;
  const annotatedCount = sources.filter((source) => source.annotationCount > 0).length;
  const knowledgeScope = useMemo(
    () => ({ kind: "project" as const, projectId: project.id }),
    [project.id],
  );
  const knowledgeScopeRevision = useMemo(
    () =>
      [...sources]
        .map((source) => source.workId)
        .sort()
        .join("\u0000"),
    [sources],
  );

  const shelvedContentUnitIds =
    shelfMembership.projectId === project.id ? shelfMembership.ids : EMPTY_SHELF_IDS;
  const shelvedSourceKeys =
    shelfMembership.projectId === project.id ? shelfMembership.sourceKeys : EMPTY_SHELF_IDS;
  const shelvedIdentityFallbackKeys =
    shelfMembership.projectId === project.id
      ? shelfMembership.identityFallbackKeys
      : EMPTY_SHELF_IDS;

  const handleShelfItemsChange = useCallback(
    (items: readonly EvidenceShelfItem[]) => {
      const sourceKeys = new Set<string>();
      const identityFallbackKeys = new Set<string>();
      for (const item of items) {
        // The strict key distinguishes changed text. Only previews explicitly
        // marked by backup redaction get the identity-only fallback, allowing
        // regenerated ContentUnit ids without masking ordinary changes.
        sourceKeys.add(evidenceShelfSourceKey(item));
        if (evidenceShelfPreviewHasRedaction(item)) {
          identityFallbackKeys.add(evidenceShelfSourceIdentityKey(item));
        }
      }
      setShelfMembership({
        identityFallbackKeys,
        ids: new Set(items.map((item) => item.previewPayload.contentUnitId)),
        projectId: project.id,
        sourceKeys,
      });
    },
    [project.id],
  );

  const requestRemove = async (source: ResearchProjectSource) => {
    const approved = await confirm({
      title: `从项目移除“${source.title}”？`,
      eyebrow: "移出研究项目",
      description: "这里只会解除项目成员关系，不会删除文献库中的论文、PDF 或批注。",
      details: [
        "文献仍会保留在 Library 中，可以随时重新加入该项目。",
        "已有 PDF 源文件、阅读进度和批注不会受到影响。",
      ],
      confirmLabel: "移出项目",
      cancelLabel: "保留来源",
    });
    if (approved) await onRemoveWork(source.workId);
  };

  const addKnowledgeResultToShelf = async (
    result: KnowledgeContentSearchResult,
    options: KnowledgeSearchOpenOptions,
  ) => {
    if (previewMode) throw new Error("浏览器预览不会保存 Evidence Shelf");
    await activeShelfService.stage(project.id, result, options);
    // The write may have succeeded just as the caller's signal was aborted.
    // Refresh before rethrowing so a persisted row is not stranded in stale UI.
    setShelfRefreshToken((current) => current + 1);
    options.signal.throwIfAborted();
  };

  return (
    <main className="research-project-page">
      <header className="research-project-header">
        <div className="research-project-header__identity">
          <ResearchProjectSwitcher
            busyAction={busyAction}
            project={project}
            projects={projects}
            onCreate={onCreate}
            onRename={onRename}
            onSelect={onSelect}
          />
          <p>
            {project.description ||
              "把与这个课题相关的文献集中起来，形成可检索、可追溯的研究范围。"}
          </p>
        </div>
        <Button type="button" onClick={() => setSourcePickerOpen(true)} disabled={busy}>
          <Plus size={16} weight="bold" />
          添加来源
        </Button>
      </header>

      {previewMode && (
        <InlineNotice
          className="research-project-notice"
          tone="warning"
          message="浏览器预览：项目操作只保存在当前页面会话，不会写入桌面数据库。"
        />
      )}

      {(error || message) && (
        <InlineNotice
          className="research-project-notice"
          message={error ?? message}
          onDismiss={onDismissFeedback}
        />
      )}

      <section className="research-project-summary" aria-label="项目摘要">
        <div>
          <BookOpenText size={18} weight="duotone" />
          <span>
            <strong>{project.sourceCount.toLocaleString("zh-CN")}</strong>
            <small>篇来源</small>
          </span>
        </div>
        <div>
          <FilePdf size={18} weight="duotone" />
          <span>
            <strong>{pdfCount.toLocaleString("zh-CN")}</strong>
            <small>篇有全文</small>
          </span>
        </div>
        <div>
          <Quotes size={18} weight="duotone" />
          <span>
            <strong>{annotatedCount.toLocaleString("zh-CN")}</strong>
            <small>篇有批注</small>
          </span>
        </div>
      </section>

      <KnowledgeSearchPanel
        key={project.id}
        enabled={!previewMode}
        onOpenResult={onOpenKnowledgeResult}
        onAddToShelf={
          !previewMode && project.status === "active" ? addKnowledgeResultToShelf : undefined
        }
        scope={knowledgeScope}
        scopeLabel={`项目 · ${project.name}`}
        scopeRevision={knowledgeScopeRevision}
        shelvedContentUnitIds={shelvedContentUnitIds}
        shelvedIdentityFallbackKeys={shelvedIdentityFallbackKeys}
        shelvedSourceKeys={shelvedSourceKeys}
      />

      <EvidenceShelfPanel
        key={`${project.id}:${previewMode ? "preview" : "desktop"}`}
        enabled={!previewMode}
        onOpenResult={onOpenKnowledgeResult}
        projectId={project.id}
        projectName={project.name}
        refreshToken={shelfRefreshToken}
        onItemsChange={handleShelfItemsChange}
        service={activeShelfService}
      />

      <section
        className="research-project-sources"
        aria-labelledby="research-project-sources-title"
      >
        <div className="research-project-sources__toolbar">
          <div>
            <h1 id="research-project-sources-title">项目来源</h1>
            <p>这是后续全文检索、证据整理与 AI 合成的明确范围。</p>
          </div>
          {sources.length > 0 && (
            <label className="research-project-source-search">
              <MagnifyingGlass size={16} aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筛选当前项目"
                aria-label="筛选当前项目来源"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="清除项目来源筛选"
                >
                  <X size={13} weight="bold" />
                </button>
              )}
            </label>
          )}
        </div>

        {sources.length === 0 ? (
          <div className="research-project-empty">
            <span aria-hidden="true">
              <BookOpenText size={28} weight="duotone" />
            </span>
            <h2>为这个项目加入第一篇来源</h2>
            <p>从文献库挑选论文；加入项目不会移动或复制原文件。</p>
            <Button type="button" onClick={() => setSourcePickerOpen(true)} disabled={busy}>
              从文献库选择
            </Button>
          </div>
        ) : visibleSources.length === 0 ? (
          <div className="research-project-empty research-project-empty--filter">
            <h2>没有匹配的项目来源</h2>
            <p>尝试搜索更短的题名、作者或年份。</p>
            <Button type="button" variant="secondary" onClick={() => setQuery("")}>
              清除筛选
            </Button>
          </div>
        ) : (
          <ProjectSourceList
            sources={visibleSources}
            busy={busyAction === "remove-source"}
            onOpen={onOpenSource}
            onRemove={(source) => void requestRemove(source)}
          />
        )}
      </section>

      {sourcePickerOpen && (
        <ProjectSourcePicker
          key={project.id}
          busy={busyAction === "add-sources"}
          projectId={project.id}
          projectName={project.name}
          service={service}
          onClose={() => {
            if (busyAction !== "add-sources") setSourcePickerOpen(false);
          }}
          onConfirm={onAddWorks}
        />
      )}
      {confirmDialog}
    </main>
  );
}
