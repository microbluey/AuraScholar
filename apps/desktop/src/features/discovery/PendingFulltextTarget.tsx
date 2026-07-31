export function PendingFulltextTarget({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="research-pending-work" role="status" aria-live="polite">
      <span>补全文目标</span>
      <strong title={title}>{title || "待补全文文献"}</strong>
      <small>{detail}</small>
    </div>
  );
}
