import { useState } from "react";
import { Badge, Button } from "@aurascholar/ui";
import type { ReadingStatus, WorkWithAuthors } from "@aurascholar/db";
import type { WorkRuntimeMeta, WorkTableMeta } from "../../services/library-page-data";
import {
  formatAttachmentSize,
  formatAttachmentSource,
  libraryTagTone,
  readingStatusLabel,
} from "./library-work-display";
import {
  LibraryBibliographicLines,
  LibraryCitationMiniGraph,
  LibraryStatusLine,
  LibraryTrashWorkPanel,
  LibraryWorkNotesPanel,
  type LibraryWorkAction,
} from "./LibrarySelectedWorkSections";

type DetailPanelTab = "overview" | "notes" | "related";

export interface LibrarySelectedWorkPanelProps {
  work: WorkWithAuthors | null;
  meta: WorkRuntimeMeta | null;
  tableMeta?: WorkTableMeta;
  isTrashView: boolean;
  attachingPdf: boolean;
  workActionBusy: LibraryWorkAction | null;
  starActionBusyTarget?: boolean;
  readingStatusBusyTarget?: ReadingStatus;
  onOpenReader: () => void;
  onRestoreWork: () => void;
  onPurgeWork: () => void;
  onDeleteWork: () => void;
  onToggleStar: () => void;
  onSetReadingStatus: (status: ReadingStatus) => void;
  onUploadPdf: () => void;
  onFindFulltext: () => void;
  findingFulltext: boolean;
  onAddToCanvas: () => void;
  onOpenCanvas: () => void;
  onOpenGraph: () => void;
  onEditMetadata: () => void;
  onClose: () => void;
}

export function LibrarySelectedWorkPanel({
  work,
  meta,
  tableMeta,
  isTrashView,
  attachingPdf,
  workActionBusy,
  starActionBusyTarget,
  readingStatusBusyTarget,
  onOpenReader,
  onRestoreWork,
  onPurgeWork,
  onDeleteWork,
  onToggleStar,
  onSetReadingStatus,
  onUploadPdf,
  onFindFulltext,
  findingFulltext,
  onAddToCanvas,
  onOpenCanvas,
  onOpenGraph,
  onEditMetadata,
  onClose,
}: LibrarySelectedWorkPanelProps) {
  const [activePanelTab, setActivePanelTab] = useState<DetailPanelTab>("overview");

  if (!work) {
    return (
      <div className="library-detail au-panel">
        <h2>文献详情</h2>
        <p className="au-text-muted">
          选择一篇文献后，这里会显示元信息、笔记、预览、研究素材和引用脉络。
        </p>
      </div>
    );
  }

  const authorText =
    work.authorNames.length > 0 ? work.authorNames.slice(0, 4).join(", ") : "作者未标注";
  const sourceText = [work.venue_name, work.year].filter(Boolean).join(" · ") || "来源未标注";
  const tags = (tableMeta?.tags ?? []).slice(0, 4);
  const starActionBusy = typeof starActionBusyTarget === "boolean";
  const readingStatusBusy = Boolean(readingStatusBusyTarget);

  if (isTrashView) {
    return (
      <LibraryTrashWorkPanel
        work={work}
        meta={meta}
        tableMeta={tableMeta}
        workActionBusy={workActionBusy}
        onRestoreWork={onRestoreWork}
        onPurgeWork={onPurgeWork}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="library-inspector library-detail--selected au-panel">
      <div className="library-inspector__summary">
        <div className="library-panel-heading">
          <span className="library-panel-kicker">当前文献</span>
          <div className="library-panel-actions">
            <button type="button" onClick={onEditMetadata}>
              编辑
            </button>
            <button
              type="button"
              onClick={onToggleStar}
              disabled={starActionBusy}
              aria-busy={starActionBusy ? "true" : undefined}
            >
              {starActionBusy
                ? starActionBusyTarget
                  ? "标记中..."
                  : "取消中..."
                : work.starred
                  ? "取消重点"
                  : "标为重点"}
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
        {tags.length > 0 && (
          <div className="library-detail__chips">
            {tags.map((tag, index) => (
              <span
                key={tag}
                className={`library-research-tag library-research-tag--${libraryTagTone(tag, index)}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
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
            <strong>{meta ? (meta.pdfCount ? "可读" : "缺失") : "—"}</strong>
            <small>全文</small>
          </span>
        </div>
        <div className="library-reading-toggle" role="group" aria-label="阅读状态">
          {(["unread", "reading", "read"] as const).map((status) => {
            const statusBusy = readingStatusBusyTarget === status;
            const isCurrentStatus = work.reading_status === status;
            const label = readingStatusLabel(status);
            return (
              <button
                key={status}
                type="button"
                aria-label={isCurrentStatus ? `${label}，当前阅读状态` : label}
                aria-pressed={isCurrentStatus}
                className={isCurrentStatus ? "library-reading-toggle__active" : ""}
                onClick={() => onSetReadingStatus(status)}
                disabled={readingStatusBusy}
                aria-busy={statusBusy ? "true" : undefined}
              >
                {statusBusy ? "更新中..." : label}
              </button>
            );
          })}
        </div>
        <Button className="library-detail__read" onClick={onOpenReader}>
          {meta?.pdfCount ? "继续阅读" : "打开阅读器"}
        </Button>
        <Button variant="secondary" className="library-panel-action" onClick={onAddToCanvas}>
          加入白板
        </Button>
      </div>

      <div className="library-side-tabs" role="tablist" aria-label="文献详情">
        {(
          [
            ["overview", "概览"],
            ["notes", `笔记 ${meta?.annotationCount ?? 0}`],
            ["related", "脉络"],
          ] as const
        ).map(([panel, label]) => (
          <button
            key={panel}
            id={`library-detail-tab-${panel}`}
            aria-controls={`library-detail-panel-${panel}`}
            aria-selected={activePanelTab === panel}
            className={`library-side-tab ${
              activePanelTab === panel ? "library-side-tab--active" : ""
            }`}
            role="tab"
            type="button"
            onClick={() => setActivePanelTab(panel)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="library-inspector__body"
        id={`library-detail-panel-${activePanelTab}`}
        role="tabpanel"
        aria-labelledby={`library-detail-tab-${activePanelTab}`}
      >
        {activePanelTab === "overview" && (
          <>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>摘要</h3>
              </div>
              <p className="library-preview-copy">{work.abstract || "暂无摘要。"}</p>
            </section>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>书目信息</h3>
              </div>
              <LibraryBibliographicLines work={work} />
              <LibraryStatusLine label="题录来源" value={sourceText} variant="neutral" />
            </section>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>全文文件</h3>
                <div className="library-panel-actions">
                  <button
                    type="button"
                    onClick={onUploadPdf}
                    disabled={attachingPdf}
                    aria-busy={attachingPdf ? "true" : undefined}
                  >
                    {attachingPdf ? "上传中..." : meta?.pdfCount ? "上传新版本" : "上传 PDF"}
                  </button>
                  {meta && !meta.pdfCount && (
                    <button
                      type="button"
                      onClick={onFindFulltext}
                      disabled={findingFulltext}
                      aria-busy={findingFulltext ? "true" : undefined}
                    >
                      {findingFulltext ? "查找中..." : "查找全文"}
                    </button>
                  )}
                </div>
              </div>
              {!meta ? (
                <div className="library-fulltext-empty" aria-live="polite">
                  正在读取全文信息...
                </div>
              ) : meta.pdfPreview ? (
                <div className="library-fulltext-file">
                  <div className="library-fulltext-file__header">
                    <span>当前阅读版本</span>
                    <Badge variant="success">{meta.pdfPreview.page_count ?? "?"} 页</Badge>
                  </div>
                  <strong title={meta.pdfPreview.original_filename ?? undefined}>
                    {meta.pdfPreview.original_filename ?? "未命名全文文件"}
                  </strong>
                  <div className="library-fulltext-file__meta">
                    <span>{formatAttachmentSize(meta.pdfPreview.byte_size)}</span>
                    <span>{formatAttachmentSource(meta.pdfPreview.fetched_via)}</span>
                    {meta.pdfCount > 1 && <span>共 {meta.pdfCount} 个版本</span>}
                  </div>
                </div>
              ) : (
                <div className="library-fulltext-empty">尚未添加全文文件</div>
              )}
            </section>
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>研究素材</h3>
              </div>
              <LibraryStatusLine
                label="批注"
                value={meta ? `${meta.annotationCount} 条` : "读取中"}
                variant={meta?.annotationCount ? "success" : "neutral"}
              />
              <LibraryStatusLine label="空间白板" value="可作为文献卡加入" variant="neutral" />
            </section>
            <section className="library-inspector__section library-inspector__section--danger">
              <button
                type="button"
                className="library-detail__secondary-danger"
                onClick={onDeleteWork}
                disabled={Boolean(workActionBusy)}
                aria-busy={workActionBusy === "trash" ? "true" : undefined}
              >
                {workActionBusy === "trash" ? "移入中..." : "移入回收站"}
              </button>
            </section>
          </>
        )}

        {activePanelTab === "notes" && (
          <>
            <LibraryWorkNotesPanel meta={meta} onOpenReader={onOpenReader} />
            <section className="library-inspector__section">
              <div className="library-panel-heading">
                <h3>空间白板</h3>
                <button type="button" onClick={onOpenCanvas}>
                  打开空间白板
                </button>
              </div>
              <p className="library-preview-copy">
                将完整文献作为卡片加入画布，再与摘录、研究笔记和 AI 合成建立连接。
              </p>
              <Button className="library-panel-action" variant="primary" onClick={onAddToCanvas}>
                加入白板
              </Button>
            </section>
          </>
        )}

        {activePanelTab === "related" && (
          <section className="library-inspector__section">
            <div className="library-panel-heading">
              <h3>引用脉络</h3>
              <button type="button" onClick={onOpenGraph}>
                打开图谱
              </button>
            </div>
            <LibraryCitationMiniGraph
              references={tableMeta?.references ?? 0}
              citedBy={tableMeta?.citedBy ?? 0}
            />
            <div className="library-citation-stats">
              <span>参考 {tableMeta?.references ?? 0}</span>
              <span>被引 {tableMeta?.citedBy ?? 0}</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
