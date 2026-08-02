import { ArrowClockwise, Funnel, Quotes, Tray } from "@phosphor-icons/react";
import { Button } from "@aurascholar/ui";
import type { EvidenceInboxFilters } from "./model";
import { hasEvidenceFilters } from "./model";

export function EvidenceInboxSkeleton() {
  return (
    <div className="evidence-skeleton" role="status" aria-label="正在载入 Evidence">
      {[0, 1, 2].map((index) => (
        <div key={index} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function EvidenceInboxError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="evidence-state evidence-state--error" role="alert">
      <ArrowClockwise size={28} weight="duotone" aria-hidden="true" />
      <h2>暂时无法载入 Evidence</h2>
      <p>{message}</p>
      <Button type="button" variant="secondary" onClick={onRetry}>
        重试
      </Button>
    </section>
  );
}

export function EvidenceInboxEmpty({
  filters,
  onResetFilters,
}: {
  filters: EvidenceInboxFilters;
  onResetFilters: () => void;
}) {
  const filtered = hasEvidenceFilters(filters);
  const projectScope = filters.scope.kind === "project";
  return (
    <section className="evidence-state">
      {filtered ? (
        <Funnel size={30} weight="duotone" aria-hidden="true" />
      ) : projectScope ? (
        <Quotes size={30} weight="duotone" aria-hidden="true" />
      ) : (
        <Tray size={30} weight="duotone" aria-hidden="true" />
      )}
      <h2>
        {filtered
          ? "没有符合条件的 Evidence"
          : projectScope
            ? "这个项目还没有 Evidence"
            : filters.scope.kind === "inbox"
              ? "收件箱已经整理完毕"
              : "还没有捕获 Evidence"}
      </h2>
      <p>
        {filtered
          ? "尝试清空关键词，或放宽类型与来源状态。"
          : projectScope
            ? "在阅读器中捕获证据，然后将它归档到这个研究项目。"
            : filters.scope.kind === "inbox"
              ? "新捕获且未归档到项目的证据会出现在这里。"
              : "在阅读器中选择文本并保存为 Evidence，随后即可在此校验与归档。"}
      </p>
      {filtered ? (
        <Button type="button" variant="secondary" onClick={onResetFilters}>
          清除筛选
        </Button>
      ) : null}
    </section>
  );
}
