import {
  ArrowLeft,
  ArrowUpRight,
  ClockCounterClockwise,
  FileArrowUp,
  FolderMinus,
  FolderSimplePlus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { Badge, Button } from "@aurascholar/ui";
import { useRef } from "react";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import type { EvidenceBusyAction } from "./useEvidenceInboxController";
import {
  canRecoverEvidenceSource,
  evidenceKindLabel,
  evidenceSourceDescription,
  sourceStatusLabel,
  type EvidenceInboxScope,
} from "./model";

export function EvidenceInspector({
  busy,
  canAssignToProject,
  item,
  onBackToList,
  onDelete,
  onOpenSource,
  onRecoverSource,
  onRemoveFromProject,
  onRequestProject,
  scope,
}: {
  busy: { action: EvidenceBusyAction; evidenceId: string } | null;
  canAssignToProject: boolean;
  item: EvidenceInboxItemDto | null;
  onBackToList?: () => void;
  onDelete: (item: EvidenceInboxItemDto) => void;
  onOpenSource: (() => void) | null;
  onRecoverSource: (item: EvidenceInboxItemDto, file: File) => Promise<boolean>;
  onRemoveFromProject: (item: EvidenceInboxItemDto) => Promise<boolean>;
  onRequestProject: (item: EvidenceInboxItemDto) => void;
  scope: EvidenceInboxScope;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!item) {
    return (
      <aside className="evidence-inspector evidence-inspector--empty">
        <span aria-hidden="true">“</span>
        <h2>选择一条 Evidence</h2>
        <p>查看完整引文、来源修订和项目归属，并执行精确回溯或来源恢复。</p>
      </aside>
    );
  }

  const itemBusy = busy?.evidenceId === item.evidence.id;
  const canAssign = item.evidence.canonicalStatus === "active" && canAssignToProject;

  return (
    <aside className="evidence-inspector" aria-busy={itemBusy} aria-label="Evidence 详情">
      {onBackToList ? (
        <button className="evidence-inspector__back" type="button" onClick={onBackToList}>
          <ArrowLeft size={16} aria-hidden="true" />
          返回 Evidence 列表
        </button>
      ) : null}
      <header>
        <div>
          <p>Evidence detail</p>
          <h2>{item.evidence.title ?? evidenceKindLabel(item.evidence.evidenceKind)}</h2>
        </div>
        <Badge variant="neutral">{evidenceKindLabel(item.evidence.evidenceKind)}</Badge>
      </header>

      <blockquote>{item.evidence.text}</blockquote>

      <section className="evidence-inspector__source" aria-labelledby="evidence-source-title">
        <div>
          <span>原始来源</span>
          <Badge
            variant={
              item.evidence.canonicalStatus !== "active"
                ? "danger"
                : item.evidence.availabilityStatus !== "available"
                  ? "warning"
                  : "success"
            }
          >
            {sourceStatusLabel(item)}
          </Badge>
        </div>
        <h3 id="evidence-source-title">{item.workTitle ?? item.assetTitle ?? "未命名来源"}</h3>
        <p>{evidenceSourceDescription(item)}</p>
        <dl>
          <div>
            <dt>绑定修订</dt>
            <dd>
              {item.revisionNo === null ? "未知" : `Revision ${item.revisionNo}`}
              {item.evidence.revisionStatus === "historical" ? (
                <span>
                  <ClockCounterClockwise size={13} />
                  历史
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>文档类型</dt>
            <dd>{item.mimeType ?? item.assetKind ?? "未知"}</dd>
          </div>
          <div>
            <dt>定位</dt>
            <dd>第 {(item.pageIndex ?? 0) + 1} 页</dd>
          </div>
        </dl>
        {item.evidence.revisionStatus === "historical" ? (
          <p className="evidence-inspector__assurance">
            <ClockCounterClockwise size={15} aria-hidden="true" />
            将打开捕获 Evidence 时的原始历史修订，不会跳转到当前版本。
          </p>
        ) : null}
        {item.evidence.canonicalStatus !== "active" ? (
          <p className="evidence-inspector__warning" role="status">
            <WarningCircle size={16} aria-hidden="true" />
            来源记录已移除。快照仍保留，但不能自动改指向其他文档。
          </p>
        ) : null}
      </section>

      {item.evidence.noteMd || item.evidence.tags.length > 0 ? (
        <section className="evidence-inspector__notes">
          <h3>研究上下文</h3>
          {item.evidence.noteMd ? <p>{item.evidence.noteMd}</p> : null}
          {item.evidence.tags.length > 0 ? (
            <div>
              {item.evidence.tags.map((tag) => (
                <Badge key={tag} variant="neutral">
                  #{tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="evidence-inspector__projects">
        <h3>项目归属</h3>
        {item.projectMemberships.length > 0 ? (
          <div>
            {item.projectMemberships.map((membership) => (
              <Badge key={membership.projectId} variant="neutral">
                {membership.projectName}
              </Badge>
            ))}
          </div>
        ) : (
          <p>尚未归档到研究项目。</p>
        )}
      </section>

      <footer>
        {onOpenSource ? (
          <Button type="button" onClick={onOpenSource} disabled={itemBusy}>
            <ArrowUpRight size={16} aria-hidden="true" />
            打开原始来源
          </Button>
        ) : null}
        {canRecoverEvidenceSource(item) ? (
          <>
            <input
              ref={fileInputRef}
              className="evidence-inspector__file"
              type="file"
              accept=".pdf,application/pdf"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onRecoverSource(item, file);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={itemBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileArrowUp size={16} aria-hidden="true" />
              恢复原始 PDF
            </Button>
          </>
        ) : null}
        {canAssign ? (
          <Button
            type="button"
            variant="secondary"
            disabled={itemBusy}
            onClick={() => onRequestProject(item)}
          >
            <FolderSimplePlus size={16} aria-hidden="true" />
            归档到项目
          </Button>
        ) : null}
        {scope.kind === "project" ? (
          <Button
            type="button"
            variant="secondary"
            disabled={itemBusy}
            onClick={() => void onRemoveFromProject(item)}
          >
            <FolderMinus size={16} aria-hidden="true" />
            移出当前项目
          </Button>
        ) : null}
        <Button type="button" variant="danger" disabled={itemBusy} onClick={() => onDelete(item)}>
          <Trash size={16} aria-hidden="true" />
          移除 Evidence
        </Button>
      </footer>
    </aside>
  );
}
