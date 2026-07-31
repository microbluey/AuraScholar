import { ArrowSquareOut, FilePdf, NotePencil, TrashSimple } from "@phosphor-icons/react";
import type { ResearchProjectSource } from "./model";

export interface ProjectSourceListProps {
  busy: boolean;
  onOpen(workId: string): void;
  onRemove(work: ResearchProjectSource): void;
  sources: readonly ResearchProjectSource[];
}

export function ProjectSourceList({ busy, onOpen, onRemove, sources }: ProjectSourceListProps) {
  return (
    <div className="project-source-list" role="list" aria-label="项目来源文献">
      {sources.map((source) => (
        <article className="project-source-row" key={source.workId} role="listitem">
          <button
            type="button"
            className="project-source-row__main"
            onClick={() => onOpen(source.workId)}
            aria-label={`打开文献：${source.title}`}
          >
            <span className="project-source-row__marker" aria-hidden="true">
              {source.pdfCount > 0 ? (
                <FilePdf size={19} weight="duotone" />
              ) : (
                <NotePencil size={19} />
              )}
            </span>
            <span className="project-source-row__copy">
              <strong>{source.title}</strong>
              <span>
                {source.authorNames.slice(0, 3).join(", ") || "作者待补充"}
                {source.authorNames.length > 3 ? " 等" : ""}
              </span>
            </span>
          </button>
          <span className="project-source-row__meta">
            <b>{source.year ?? "—"}</b>
            <small>{source.venue ?? "来源待补充"}</small>
          </span>
          <span className="project-source-row__signals">
            <small>{source.pdfCount > 0 ? `${source.pdfCount} 份全文` : "缺全文"}</small>
            <small>
              {source.annotationCount > 0 ? `${source.annotationCount} 条批注` : "暂无批注"}
            </small>
          </span>
          <span className="project-source-row__actions">
            <button
              type="button"
              onClick={() => onOpen(source.workId)}
              aria-label={`在文献库打开 ${source.title}`}
              title="在文献库打开"
            >
              <ArrowSquareOut size={16} />
            </button>
            <button
              type="button"
              className="project-source-row__remove"
              onClick={() => onRemove(source)}
              aria-label={`从项目移除 ${source.title}，不会删除文献库原文或 PDF`}
              title="只移出项目，不删除文献库与 PDF"
              disabled={busy}
            >
              <TrashSimple size={16} />
            </button>
          </span>
        </article>
      ))}
    </div>
  );
}
