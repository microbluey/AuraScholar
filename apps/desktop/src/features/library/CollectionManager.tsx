import { useCallback, useId, useRef } from "react";
import type { CollectionRow } from "@aurascholar/db";
import { useModalFocusTrap } from "../../components/useModalFocusTrap";

export interface CollectionManagerAction {
  id: string;
  kind: "create" | "delete" | "rename" | "restore";
}

export interface CollectionManagerProps {
  collections: CollectionRow[];
  activeCollection: string | null;
  action: CollectionManagerAction | null;
  status: string | null;
  statusAction: {
    ariaLabel: string;
    busy: boolean;
    label: string;
    onClick: () => void;
  } | null;
  error: string | null;
  trashCount: number;
  isTrashView: boolean;
  onClose: () => void;
  onSelectAll: () => void;
  onSelectTrash: () => void;
  onSelectCollection: (collectionId: string) => void;
  onCreate: (parentId?: string) => void;
  onRename: (collection: CollectionRow) => void;
  onDelete: (collection: CollectionRow) => void;
}

export function CollectionManager({
  collections,
  activeCollection,
  action,
  status,
  statusAction,
  error,
  trashCount,
  isTrashView,
  onClose,
  onSelectAll,
  onSelectTrash,
  onSelectCollection,
  onCreate,
  onRename,
  onDelete,
}: CollectionManagerProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const busy = action !== null;
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useModalFocusTrap(dialogRef, {
    initialFocusSelector: "[data-autofocus]",
    onEscape: requestClose,
  });

  return (
    <div className="library-modal-overlay" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-busy={busy}
        aria-modal="true"
        className="library-modal library-collection-modal"
        data-library-dialog="collection-manager"
        data-modal-root="true"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <div className="library-modal__head">
          <div>
            <h2 id={titleId}>管理文件夹</h2>
            <p className="library-modal__subhead">选择当前视图，或整理自定义文件夹。</p>
          </div>
          <button
            type="button"
            className="library-modal__close"
            data-library-action="close-collection-manager"
            onClick={requestClose}
            aria-label="关闭管理文件夹"
            title="关闭管理文件夹"
            disabled={busy}
          >
            ×
          </button>
        </div>

        {status && (
          <p className="library-collection-manager__status" role="status" aria-live="polite">
            <span>{status}</span>
            {statusAction ? (
              <button
                type="button"
                className="library-collection-manager__status-action"
                data-library-action="restore-collection"
                onClick={statusAction.onClick}
                disabled={busy || statusAction.busy}
                aria-busy={statusAction.busy ? "true" : undefined}
                aria-label={statusAction.ariaLabel}
              >
                {statusAction.label}
              </button>
            ) : null}
          </p>
        )}
        {error && (
          <p className="library-collection-manager__error" role="alert">
            {error}
          </p>
        )}

        <div className="library-collection-manager__section">
          <button
            type="button"
            className={`library-collection-manager__system ${
              !activeCollection && !isTrashView ? "library-collection-manager__system--active" : ""
            }`}
            data-library-action="select-all"
            data-autofocus={!activeCollection && !isTrashView ? "true" : undefined}
            onClick={onSelectAll}
            disabled={busy}
            aria-current={!activeCollection && !isTrashView ? "page" : undefined}
            aria-label={`全部文献，主视图${!activeCollection && !isTrashView ? "，当前视图" : ""}`}
            aria-pressed={!activeCollection && !isTrashView}
          >
            <span>全部文献</span>
            <small>主视图</small>
          </button>
          <button
            type="button"
            className={`library-collection-manager__system ${
              isTrashView ? "library-collection-manager__system--active" : ""
            }`}
            data-library-action="select-trash"
            data-autofocus={isTrashView ? "true" : undefined}
            onClick={onSelectTrash}
            disabled={busy}
            aria-current={isTrashView ? "page" : undefined}
            aria-label={`回收站，${trashCount.toLocaleString("zh-CN")} 篇${isTrashView ? "，当前视图" : ""}`}
            aria-pressed={isTrashView}
          >
            <span>回收站</span>
            <small>{trashCount.toLocaleString("zh-CN")} 篇</small>
          </button>
        </div>

        <div className="library-collection-manager__head">
          <span>自定义文件夹</span>
          <button
            type="button"
            data-library-action="create-collection"
            onClick={() => onCreate()}
            disabled={busy}
            aria-busy={action?.kind === "create" ? "true" : undefined}
            aria-label="新建文件夹"
          >
            {action?.kind === "create" ? "创建中..." : "新建"}
          </button>
        </div>

        {collections.length === 0 ? (
          <p className="library-panel-empty">还没有文件夹。新建后会同时出现在左侧文件夹树里。</p>
        ) : (
          <ul className="library-collection-manager">
            {collections.map((collection) => {
              const activeAction = action?.id === collection.id ? action.kind : null;
              const parent = collection.parent_id
                ? collections.find((candidate) => candidate.id === collection.parent_id)
                : null;
              return (
                <li
                  key={collection.id}
                  className={`library-collection-manager__row ${
                    activeCollection === collection.id
                      ? "library-collection-manager__row--active"
                      : ""
                  }`}
                  aria-busy={activeAction ? "true" : undefined}
                  data-collection-id={collection.id}
                >
                  <button
                    type="button"
                    className="library-collection-manager__select"
                    data-library-action="select-collection"
                    data-autofocus={activeCollection === collection.id ? "true" : undefined}
                    onClick={() => onSelectCollection(collection.id)}
                    disabled={busy}
                    aria-current={activeCollection === collection.id ? "page" : undefined}
                    aria-label={`${collection.name}，${collection.count.toLocaleString("zh-CN")} 篇${
                      activeCollection === collection.id ? "，当前视图" : ""
                    }`}
                    title={collection.name}
                  >
                    <span>{collection.name}</span>
                    <small>
                      {parent ? `${parent.name} / ` : ""}
                      {collection.count.toLocaleString("zh-CN")} 篇
                    </small>
                  </button>
                  <button
                    type="button"
                    data-library-action="create-child-collection"
                    onClick={() => onCreate(collection.id)}
                    disabled={busy}
                    aria-label={`在 ${collection.name} 中新建子文件夹`}
                    title={`在 ${collection.name} 中新建子文件夹`}
                  >
                    子文件夹
                  </button>
                  <button
                    type="button"
                    data-library-action="rename-collection"
                    onClick={() => onRename(collection)}
                    disabled={busy}
                    aria-busy={activeAction === "rename" ? "true" : undefined}
                    aria-label={`重命名文件夹 ${collection.name}`}
                    title={`重命名 ${collection.name}`}
                  >
                    {activeAction === "rename" ? "保存中..." : "重命名"}
                  </button>
                  <button
                    type="button"
                    className="library-collection-manager__delete"
                    data-library-action="delete-collection"
                    onClick={() => onDelete(collection)}
                    disabled={busy}
                    aria-busy={activeAction === "delete" ? "true" : undefined}
                    aria-label={`删除文件夹 ${collection.name}`}
                    title={`删除 ${collection.name}`}
                  >
                    {activeAction === "delete" ? "删除中..." : "删除"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
