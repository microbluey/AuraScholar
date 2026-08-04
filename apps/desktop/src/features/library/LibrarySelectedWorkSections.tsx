import { Badge, Button } from "@aurascholar/ui";
import type { WorkWithAuthors } from "@aurascholar/db";
import type { WorkRuntimeMeta, WorkTableMeta } from "../../services/library-page-data";
import type { SelectedWorkRuntimeMetaStatus } from "./useSelectedWorkRuntimeMeta";
import {
  annotationTypeLabel,
  formatLibraryDateTime,
  libraryTagTone,
  notePreviewText,
} from "./library-work-display";

export type LibraryWorkAction = "merge" | "purge" | "restore" | "trash";

export function LibraryTrashWorkPanel({
  work,
  meta,
  metaStatus,
  tableMeta,
  workActionBusy,
  onRestoreWork,
  onPurgeWork,
  onClose,
}: {
  work: WorkWithAuthors;
  meta: WorkRuntimeMeta | null;
  metaStatus: SelectedWorkRuntimeMetaStatus;
  tableMeta?: WorkTableMeta;
  workActionBusy: LibraryWorkAction | null;
  onRestoreWork: () => void;
  onPurgeWork: () => void;
  onClose: () => void;
}) {
  const authorText =
    work.authorNames.length > 0 ? work.authorNames.slice(0, 4).join(", ") : "作者未标注";
  const sourceText = [work.venue_name, work.year].filter(Boolean).join(" · ") || "来源未标注";
  const tags = (tableMeta?.tags ?? []).slice(0, 4);

  return (
    <>
      <div className="library-detail au-panel library-detail--selected library-detail--trash">
        <div className="library-panel-heading">
          <span className="library-panel-kicker">回收站文献</span>
          <div className="library-panel-actions">
            <button
              type="button"
              onClick={onRestoreWork}
              disabled={Boolean(workActionBusy)}
              aria-busy={workActionBusy === "restore" ? "true" : undefined}
            >
              {workActionBusy === "restore" ? "恢复中..." : "恢复 ›"}
            </button>
            <button
              type="button"
              className="library-inspector-close"
              onClick={onClose}
              aria-label="关闭文献详情"
              title="关闭详情"
            >
              ×
            </button>
          </div>
        </div>
        <h2>{work.title}</h2>
        <p>{authorText}</p>
        <div className="library-detail__meta-grid">
          <span>
            <strong>{work.year ?? "—"}</strong>
            <small>年份</small>
          </span>
          <span>
            <strong>{work.venue_name ?? "—"}</strong>
            <small>来源</small>
          </span>
          <span>
            <strong>{work.doi ? "有" : "无"}</strong>
            <small>DOI</small>
          </span>
        </div>
        <div className="library-detail__chips">
          {tags.length > 0 ? (
            tags.map((tag, index) => (
              <span
                key={tag}
                className={`library-research-tag library-research-tag--${libraryTagTone(tag, index)}`}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="library-research-tag library-research-tag--neutral">未标注</span>
          )}
        </div>
        <Button
          className="library-detail__read"
          onClick={onRestoreWork}
          disabled={Boolean(workActionBusy)}
          aria-busy={workActionBusy === "restore" ? "true" : undefined}
        >
          {workActionBusy === "restore" ? "恢复中..." : "恢复到文献库"}
        </Button>
        <button
          type="button"
          className="library-danger-button"
          onClick={onPurgeWork}
          disabled={Boolean(workActionBusy)}
          aria-busy={workActionBusy === "purge" ? "true" : undefined}
        >
          {workActionBusy === "purge" ? "删除中..." : "永久删除"}
        </button>
      </div>
      <div className="library-automation au-panel">
        <div className="library-panel-heading">
          <h3>书目信息</h3>
        </div>
        <LibraryBibliographicLines work={work} />
        <LibraryStatusLine label="题录来源" value={sourceText} variant="neutral" />
        <LibraryStatusLine
          label="PDF 附件"
          value={
            metaStatus === "error"
              ? "读取失败"
              : meta
                ? meta.pdfCount
                  ? `${meta.pdfCount} 个`
                  : "无"
                : "读取中"
          }
          variant={meta?.pdfCount ? "success" : "neutral"}
        />
        <p className="library-preview-copy">{work.abstract || "暂无摘要。"}</p>
      </div>
    </>
  );
}

export function LibraryWorkNotesPanel({
  meta,
  metaStatus,
  onOpenReader,
}: {
  meta: WorkRuntimeMeta | null;
  metaStatus: SelectedWorkRuntimeMetaStatus;
  onOpenReader: () => void;
}) {
  const notes = meta?.notePreviews ?? [];
  return (
    <section className="library-inspector__section">
      <div className="library-panel-heading">
        <h3>笔记 / 批注</h3>
        <button type="button" onClick={onOpenReader}>
          编辑笔记 ›
        </button>
      </div>
      <LibraryStatusLine
        label="总数"
        value={metaStatus === "error" ? "读取失败" : meta ? `${meta.annotationCount} 条` : "读取中"}
        variant={meta?.annotationCount ? "success" : "neutral"}
      />
      {notes.length > 0 ? (
        <div className="library-notes-list library-notes-list--expanded">
          {notes.map((note) => (
            <article key={note.id} className="library-note-preview">
              <div>
                <strong>{annotationTypeLabel(note.type)}</strong>
                <small>
                  第 {note.page_index + 1} 页 · {formatLibraryDateTime(note.updated_at)}
                </small>
              </div>
              <p>{notePreviewText(note)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="library-panel-empty">
          {metaStatus === "error"
            ? "笔记暂时无法读取，请刷新后重试。"
            : meta
              ? "暂无笔记。进入阅读器后可以高亮、批注和整理摘录。"
              : "正在读取笔记…"}
        </p>
      )}
    </section>
  );
}

// Thumbnail of the citation neighborhood. Node counts are real (from the local
// `citations` table); the full interactive graph lives on the /graph route. We
// cap rendered dots at 5 per side so the thumbnail stays legible — the exact
// counts are shown numerically beneath it.
export function LibraryCitationMiniGraph({
  references,
  citedBy,
}: {
  references: number;
  citedBy: number;
}) {
  if (references === 0 && citedBy === 0) {
    return (
      <div className="library-citation-mini library-citation-mini--empty">
        本地暂无引文边。打开图谱可抓取上下游引用。
      </div>
    );
  }
  const spread = (n: number) => {
    const shown = Math.min(n, 5);
    if (shown === 0) return [];
    const top = 18;
    const bottom = 94;
    const step = shown === 1 ? 0 : (bottom - top) / (shown - 1);
    return Array.from({ length: shown }, (_, i) => top + step * i);
  };
  const left = spread(references);
  const right = spread(citedBy);
  return (
    <svg
      className="library-citation-mini"
      viewBox="0 0 260 112"
      role="img"
      aria-label={`引用脉络缩略图:参考 ${references} 篇，被引 ${citedBy} 篇`}
    >
      <text
        x="6"
        y="55"
        className="library-citation-mini__label library-citation-mini__label--left"
      >
        参考文献
      </text>
      <text
        x="206"
        y="55"
        className="library-citation-mini__label library-citation-mini__label--right"
      >
        被引文献
      </text>
      {left.map((y, i) => (
        <g key={`left-${i}`}>
          <path d={`M76 ${y} C 98 ${y}, 102 56, 124 56`} />
          <circle cx="72" cy={y} r={4} />
        </g>
      ))}
      {right.map((y, i) => (
        <g key={`right-${i}`}>
          <path
            d={`M136 56 C 160 56, 164 ${y}, 186 ${y}`}
            className="library-citation-mini__right-edge"
          />
          <circle className="library-citation-mini__right-node" cx="190" cy={y} r={4} />
        </g>
      ))}
      <circle className="library-citation-mini__center" cx="130" cy="56" r="18" />
      <text x="130" y="60" textAnchor="middle" className="library-citation-mini__center-label">
        本文
      </text>
    </svg>
  );
}

export function LibraryStatusLine({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "accent" | "neutral" | "success" | "warning";
}) {
  return (
    <div className="library-status-line">
      <span>{label}</span>
      <Badge variant={variant}>{value}</Badge>
    </div>
  );
}

/** Read-only list of the rich bibliographic fields that are populated. */
export function LibraryBibliographicLines({ work }: { work: WorkWithAuthors }) {
  const vol = [
    work.volume && `卷 ${work.volume}`,
    work.issue && `期 ${work.issue}`,
    work.pages && `页 ${work.pages}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines: Array<[string, string | null]> = [
    ["卷期页", vol || null],
    ["出版社", work.publisher],
    ["出版地", work.place_published],
    ["版本", work.edition],
    ["ISSN", work.issn],
    ["ISBN", work.isbn],
    ["语言", work.language],
    ["DOI", work.doi],
  ];
  const present = lines.filter(([, v]) => v);
  if (present.length === 0) {
    return (
      <p className="library-bib-empty au-text-muted">
        暂无详细书目信息,点「编辑」补全卷期页、出版社、ISSN 等。
      </p>
    );
  }
  return (
    <dl className="library-bib-list">
      {present.map(([label, value]) => (
        <div className="library-bib-row" key={label}>
          <dt>{label}</dt>
          <dd title={value!}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
