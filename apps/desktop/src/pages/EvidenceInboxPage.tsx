import { Archive, CheckCircle, CircleNotch, Quotes, WarningCircle, X } from "@phosphor-icons/react";
import { Badge, Button } from "@aurascholar/ui";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirmDialog } from "../components/ConfirmDialog";
import { EvidenceCard } from "../features/evidence/EvidenceCard";
import {
  EvidenceInboxEmpty,
  EvidenceInboxError,
  EvidenceInboxSkeleton,
} from "../features/evidence/EvidenceInboxStates";
import { EvidenceInboxToolbar } from "../features/evidence/EvidenceInboxToolbar";
import { EvidenceInspector } from "../features/evidence/EvidenceInspector";
import { EvidenceProjectPicker } from "../features/evidence/EvidenceProjectPicker";
import {
  resolveEvidenceInboxService,
  type EvidenceInboxService,
} from "../features/evidence/evidence-inbox-service";
import { DEFAULT_EVIDENCE_FILTERS, evidenceReaderPath } from "../features/evidence/model";
import { useEvidenceInboxController } from "../features/evidence/useEvidenceInboxController";
import { isDesktopRuntime } from "../services/aura-platform";
import "../features/evidence/evidence-inbox.css";
import "../features/evidence/evidence-inspector.css";
import "../features/evidence/evidence-overlays.css";

export function EvidenceInboxPage({
  service: suppliedService,
}: {
  service?: EvidenceInboxService;
}) {
  const navigate = useNavigate();
  const [service] = useState(() => suppliedService ?? resolveEvidenceInboxService());
  const [mobilePanel, setMobilePanel] = useState<"detail" | "list">("list");
  const [projectPickerItemId, setProjectPickerItemId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const {
    addToProject,
    clearMutationError,
    clearUndo,
    loadMore,
    recoverSource,
    removeFromCurrentProject,
    restoreDeleted,
    retry,
    setFilters,
    setSelectedId,
    snapshot,
    softDelete,
  } = useEvidenceInboxController(service);

  const selectedItem = useMemo(
    () =>
      snapshot.items.find((item) => item.evidence.id === snapshot.selectedId) ??
      snapshot.items[0] ??
      null,
    [snapshot.items, snapshot.selectedId],
  );
  const projectPickerItem =
    snapshot.items.find((item) => item.evidence.id === projectPickerItemId) ?? null;

  const openSource = (item: typeof selectedItem) => {
    if (!item) return;
    const path = evidenceReaderPath(item);
    if (path) navigate(path);
  };

  const requestDelete = async (item: NonNullable<typeof selectedItem>) => {
    const quote = item.evidence.text.trim().replace(/\s+/g, " ");
    const confirmed = await confirm({
      confirmLabel: "移除 Evidence",
      description: (
        <>将移除“{quote.length > 90 ? `${quote.slice(0, 90)}…` : quote}”。此操作可以立即撤销。</>
      ),
      details: [
        <>不会删除 Library 中的论文条目或 PDF 源文件。</>,
        item.projectMemberships.length > 0 ? (
          <>它当前归属于 {item.projectMemberships.length} 个研究项目。</>
        ) : (
          <>它当前尚未归档到研究项目。</>
        ),
      ],
      eyebrow: "可恢复移除",
      title: "移除这条 Evidence？",
      tone: "danger",
    });
    if (confirmed && (await softDelete(item))) setMobilePanel("list");
  };

  const resetFilters = () => {
    setMobilePanel("list");
    setFilters((current) => ({
      ...DEFAULT_EVIDENCE_FILTERS,
      scope: current.scope,
    }));
  };

  const selectedReaderPath = selectedItem ? evidenceReaderPath(selectedItem) : null;

  return (
    <main className="evidence-page">
      <header className="evidence-page__header">
        <div className="evidence-page__heading">
          <span aria-hidden="true">
            <Archive size={24} weight="duotone" />
          </span>
          <div>
            <p>Knowledge evidence</p>
            <h1>证据收件箱</h1>
            <span>先保留原始语境，再把可验证的 Evidence 归档到研究项目。</span>
          </div>
        </div>
        <div className="evidence-page__summary" aria-label="Evidence 统计">
          <strong>{snapshot.total}</strong>
          <span>条结果</span>
          <Badge variant={isDesktopRuntime() ? "success" : "warning"}>
            {isDesktopRuntime() ? "本地知识库" : "浏览器预览"}
          </Badge>
        </div>
      </header>

      <EvidenceInboxToolbar
        filters={snapshot.filters}
        onChange={(update) => {
          setMobilePanel("list");
          setFilters(update);
        }}
        projects={snapshot.projects}
        projectsLoading={snapshot.projectsLoading}
        refreshing={snapshot.refreshing}
      />

      {snapshot.mutationError ? (
        <div className="evidence-feedback evidence-feedback--error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <span>{snapshot.mutationError}</span>
          <button type="button" aria-label="关闭错误提示" onClick={clearMutationError}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className={`evidence-workspace evidence-workspace--${mobilePanel}`}>
        <section
          className="evidence-results"
          aria-label="Evidence 列表"
          aria-busy={snapshot.refreshing}
        >
          <div className="evidence-results__heading">
            <div>
              <Quotes size={17} weight="duotone" aria-hidden="true" />
              <h2>Evidence</h2>
            </div>
            <span>
              {snapshot.items.length} / {snapshot.total}
            </span>
          </div>

          {snapshot.initialLoading && snapshot.items.length === 0 ? (
            <EvidenceInboxSkeleton />
          ) : snapshot.error && snapshot.items.length === 0 ? (
            <EvidenceInboxError message={snapshot.error} onRetry={retry} />
          ) : snapshot.items.length === 0 ? (
            <EvidenceInboxEmpty filters={snapshot.filters} onResetFilters={resetFilters} />
          ) : (
            <>
              {snapshot.error ? (
                <div className="evidence-results__inline-error" role="alert">
                  <span>{snapshot.error}</span>
                  <button type="button" onClick={retry}>
                    重试
                  </button>
                </div>
              ) : null}
              <div className="evidence-results__list">
                {snapshot.items.map((item) => {
                  const readerPath = evidenceReaderPath(item);
                  return (
                    <EvidenceCard
                      key={item.evidence.id}
                      item={item}
                      selected={selectedItem?.evidence.id === item.evidence.id}
                      onSelect={() => {
                        setSelectedId(item.evidence.id);
                        setMobilePanel("detail");
                      }}
                      onOpenSource={readerPath ? () => navigate(readerPath) : null}
                    />
                  );
                })}
              </div>
              {snapshot.items.length < snapshot.total ? (
                <Button
                  className="evidence-results__more"
                  type="button"
                  variant="secondary"
                  disabled={snapshot.loadingMore}
                  onClick={() => void loadMore()}
                >
                  {snapshot.loadingMore ? (
                    <CircleNotch className="evidence-spin" size={16} />
                  ) : null}
                  {snapshot.loadingMore ? "正在载入…" : "载入更多"}
                </Button>
              ) : null}
            </>
          )}
        </section>

        <EvidenceInspector
          busy={snapshot.busy}
          canAssignToProject={Boolean(
            selectedItem &&
            snapshot.projects.some(
              (project) =>
                !selectedItem.projectMemberships.some(
                  (membership) => membership.projectId === project.id,
                ),
            ),
          )}
          item={selectedItem}
          onBackToList={() => setMobilePanel("list")}
          onDelete={(item) => void requestDelete(item)}
          onOpenSource={selectedReaderPath ? () => openSource(selectedItem) : null}
          onRecoverSource={recoverSource}
          onRemoveFromProject={async (item) => {
            const removed = await removeFromCurrentProject(item);
            if (removed) setMobilePanel("list");
            return removed;
          }}
          onRequestProject={(item) => setProjectPickerItemId(item.evidence.id)}
          scope={snapshot.filters.scope}
        />
      </div>

      {snapshot.undo ? (
        <div className="evidence-undo" role="status" aria-live="polite">
          <CheckCircle size={18} weight="duotone" aria-hidden="true" />
          <span>Evidence 已移除，Library 论文与源文件保持不变。</span>
          <button
            type="button"
            disabled={snapshot.busy?.action === "restore"}
            onClick={() => void restoreDeleted()}
          >
            撤销
          </button>
          <button type="button" aria-label="关闭撤销提示" onClick={clearUndo}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <EvidenceProjectPicker
        busy={snapshot.busy?.action === "assign"}
        item={projectPickerItem}
        projects={snapshot.projects}
        onCancel={() => setProjectPickerItemId(null)}
        onConfirm={async (projectId) => {
          if (!projectPickerItem) return false;
          const assigned = await addToProject(projectPickerItem, projectId);
          if (assigned && snapshot.filters.scope.kind === "inbox") setMobilePanel("list");
          return assigned;
        }}
      />
      {confirmDialog}
    </main>
  );
}
