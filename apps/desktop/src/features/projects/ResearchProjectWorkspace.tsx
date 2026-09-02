import { BookOpenText, FilePdf, MagnifyingGlass, Plus, Quotes, X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@aurascholar/ui";
import { useConfirmDialog } from "../../components/ConfirmDialog";
import { InlineNotice } from "../../components/InlineNotice";
import type { KnowledgeContentSearchResult } from "../../services/knowledge-search";
import type { KnowledgeSearchOpenOptions } from "../library/KnowledgeSearchPanel";
import type { ResearchProjectService } from "../../services/research-project-service";
import type {
  ResearchProjectBusyAction,
  ResearchProjectSource,
  ResearchProjectSummary,
} from "./model";
import { ProjectSourceList } from "./ProjectSourceList";
import { ProjectSourcePicker } from "./ProjectSourcePicker";
import { ResearchProjectSwitcher } from "./ResearchProjectSwitcher";
import { KnowledgeSearchPanel } from "../library/KnowledgeSearchPanel";

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
}: ResearchProjectWorkspaceProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();
  const busy = busyAction !== null;
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
        scope={knowledgeScope}
        scopeLabel={`项目 · ${project.name}`}
        scopeRevision={knowledgeScopeRevision}
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
