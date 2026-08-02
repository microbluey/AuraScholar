import { FolderOpen, MagnifyingGlass, Tray, X } from "@phosphor-icons/react";
import type { Dispatch, SetStateAction } from "react";
import type { EvidenceProjectOption } from "./evidence-inbox-service";
import { EVIDENCE_KIND_OPTIONS, type EvidenceInboxFilters, type EvidenceInboxScope } from "./model";

export interface EvidenceInboxToolbarProps {
  filters: EvidenceInboxFilters;
  onChange: Dispatch<SetStateAction<EvidenceInboxFilters>>;
  projects: readonly EvidenceProjectOption[];
  projectsLoading: boolean;
  refreshing: boolean;
}

export function EvidenceInboxToolbar({
  filters,
  onChange,
  projects,
  projectsLoading,
  refreshing,
}: EvidenceInboxToolbarProps) {
  const setScope = (scope: EvidenceInboxScope) => onChange((current) => ({ ...current, scope }));

  return (
    <section className="evidence-toolbar" aria-label="Evidence 筛选">
      <div className="evidence-toolbar__scope" role="tablist" aria-label="Evidence 范围">
        <button
          type="button"
          className={filters.scope.kind === "inbox" ? "is-active" : ""}
          role="tab"
          aria-selected={filters.scope.kind === "inbox"}
          onClick={() => setScope({ kind: "inbox" })}
        >
          <Tray size={16} aria-hidden="true" />
          未归档
        </button>
        <button
          type="button"
          className={filters.scope.kind === "library" ? "is-active" : ""}
          role="tab"
          aria-selected={filters.scope.kind === "library"}
          onClick={() => setScope({ kind: "library" })}
        >
          全部
        </button>
        <label
          className={`evidence-toolbar__project${filters.scope.kind === "project" ? " is-active" : ""}`}
        >
          <FolderOpen size={16} aria-hidden="true" />
          <span className="sr-only">按研究项目筛选</span>
          <select
            aria-label="按研究项目筛选"
            disabled={projectsLoading || projects.length === 0}
            value={filters.scope.kind === "project" ? filters.scope.projectId : ""}
            onChange={(event) => {
              if (event.target.value) setScope({ kind: "project", projectId: event.target.value });
            }}
          >
            <option value="">{projectsLoading ? "项目载入中…" : "研究项目"}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="evidence-toolbar__filters">
        <label className="evidence-toolbar__search">
          <MagnifyingGlass size={17} aria-hidden="true" />
          <span className="sr-only">搜索证据</span>
          <input
            type="search"
            value={filters.query}
            placeholder="搜索引文、标题、作者或标签"
            onChange={(event) => onChange((current) => ({ ...current, query: event.target.value }))}
          />
          {filters.query ? (
            <button
              type="button"
              aria-label="清空搜索"
              title="清空搜索"
              onClick={() => onChange((current) => ({ ...current, query: "" }))}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <label>
          <span className="sr-only">Evidence 类型</span>
          <select
            aria-label="Evidence 类型"
            value={filters.evidenceKind}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                evidenceKind: event.target.value as EvidenceInboxFilters["evidenceKind"],
              }))
            }
          >
            <option value="all">全部类型</option>
            {EVIDENCE_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="sr-only">来源状态</span>
          <select
            aria-label="来源状态"
            value={filters.source}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                source: event.target.value as EvidenceInboxFilters["source"],
              }))
            }
          >
            <option value="all">全部来源状态</option>
            <option value="available">可打开</option>
            <option value="historical">历史修订</option>
            <option value="unavailable">需要恢复</option>
            <option value="removed">来源已移除</option>
          </select>
        </label>
      </div>
      {refreshing ? (
        <span className="evidence-toolbar__refresh" role="status">
          正在刷新…
        </span>
      ) : null}
    </section>
  );
}
