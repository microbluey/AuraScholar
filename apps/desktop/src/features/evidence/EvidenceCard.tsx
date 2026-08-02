import { ArrowUpRight, FileText, FolderSimple, Quotes } from "@phosphor-icons/react";
import { Badge } from "@aurascholar/ui";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import { evidenceKindLabel, evidenceSourceDescription, sourceStatusLabel } from "./model";

export function EvidenceCard({
  item,
  onOpenSource,
  onSelect,
  selected,
}: {
  item: EvidenceInboxItemDto;
  onOpenSource: (() => void) | null;
  onSelect: () => void;
  selected: boolean;
}) {
  const statusTone =
    item.evidence.canonicalStatus !== "active"
      ? "danger"
      : item.evidence.availabilityStatus !== "available"
        ? "warning"
        : item.evidence.revisionStatus === "historical"
          ? "neutral"
          : "success";

  return (
    <article
      className={`evidence-card${selected ? " evidence-card--selected" : ""}`}
      data-evidence-id={item.evidence.id}
    >
      <button
        type="button"
        className="evidence-card__select"
        aria-pressed={selected}
        aria-label={`查看证据：${item.evidence.text}`}
        onClick={onSelect}
      >
        <span className="evidence-card__kind">
          <Quotes size={15} weight="duotone" aria-hidden="true" />
          {evidenceKindLabel(item.evidence.evidenceKind)}
        </span>
        <blockquote>{item.evidence.text}</blockquote>
        <span className="evidence-card__source">
          <FileText size={15} aria-hidden="true" />
          <span>
            <strong>{item.workTitle ?? item.assetTitle ?? "未命名来源"}</strong>
            <small>{evidenceSourceDescription(item)}</small>
          </span>
        </span>
        <span className="evidence-card__badges">
          <Badge variant={statusTone}>{sourceStatusLabel(item)}</Badge>
          {item.revisionNo !== null ? (
            <Badge variant="neutral">修订 {item.revisionNo}</Badge>
          ) : null}
          {item.projectMemberships.slice(0, 2).map((membership) => (
            <Badge key={membership.projectId} variant="neutral">
              <FolderSimple size={11} aria-hidden="true" />
              {membership.projectName}
            </Badge>
          ))}
          {item.projectMemberships.length > 2 ? (
            <Badge variant="neutral">+{item.projectMemberships.length - 2}</Badge>
          ) : null}
        </span>
      </button>
      {onOpenSource ? (
        <button
          type="button"
          className="evidence-card__open"
          aria-label={`打开原始来源：${item.workTitle ?? "文献"}`}
          title="打开原始来源"
          onClick={onOpenSource}
        >
          <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}
