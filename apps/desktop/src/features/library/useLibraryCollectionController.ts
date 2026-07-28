import { useCallback, useEffect, useState } from "react";
import type { CollectionRow } from "@aurascholar/db";
import type { ConfirmFunction } from "../../components/ConfirmDialog";
import { isDesktopRuntime } from "../../services/aura-platform";
import {
  createLibraryCollection,
  deleteLibraryCollection,
  moveLibraryCollection,
  renameLibraryCollection,
  restoreLibraryCollection,
} from "../../services/library-organization";
import { describeSafeError } from "../../services/sensitive-text";
import type { TextPromptConfig } from "./TextPromptDialog";
import {
  LIBRARY_COLLECTION_EVENTS,
  type CollectionContextActionEventDetail,
  type CollectionDeleteUndoState,
  type CollectionManagerAction,
  type CreateCollectionEventDetail,
  type MoveCollectionEventDetail,
} from "./library-collection-model";

const MIN_COLLECTION_ACTION_BUSY_MS = 250;

interface LibraryCollectionSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__?: string;
}

type LibraryCollectionSmokeFlags = Pick<
  LibraryCollectionSmokeWindow,
  | "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__"
  | "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__"
  | "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__"
  | "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__"
>;

export type CollectionActivationReason = "create" | "restore";

export type CollectionManagerViewTarget =
  | { kind: "all" }
  | { kind: "trash" }
  | { kind: "collection"; collectionId: string };

interface UseLibraryCollectionControllerOptions {
  activeCollection: string | null;
  collections: CollectionRow[];
  confirm: ConfirmFunction;
  refreshLibrary: () => Promise<void | Error>;
  setMessage: (message: string) => void;
  activateCollection: (id: string, reason: CollectionActivationReason) => void;
  clearActiveCollection: () => void;
  previewMoveCollection: (detail: MoveCollectionEventDetail) => void;
  selectManagerView: (target: CollectionManagerViewTarget) => void;
}

export interface LibraryCollectionController {
  action: CollectionManagerAction | null;
  deleteUndo: CollectionDeleteUndoState | null;
  error: string | null;
  managerOpen: boolean;
  prompt: TextPromptConfig | null;
  status: string | null;
  closeManager: () => void;
  closePrompt: () => void;
  createCollection: (parentId?: string | null) => void;
  deleteCollection: (collection: Pick<CollectionRow, "id" | "name">) => Promise<void>;
  moveCollection: (detail: MoveCollectionEventDetail) => Promise<void>;
  openManager: () => void;
  renameCollection: (collection: Pick<CollectionRow, "id" | "name">) => void;
  restoreDeletedCollection: () => Promise<void>;
  selectAllFromManager: () => void;
  selectCollectionFromManager: (collectionId: string) => void;
  selectTrashFromManager: () => void;
}

export function useLibraryCollectionController({
  activeCollection,
  collections,
  confirm,
  refreshLibrary,
  setMessage,
  activateCollection,
  clearActiveCollection,
  previewMoveCollection,
  selectManagerView,
}: UseLibraryCollectionControllerOptions): LibraryCollectionController {
  const [managerOpen, setManagerOpen] = useState(false);
  const [prompt, setPrompt] = useState<TextPromptConfig | null>(null);
  const [action, setAction] = useState<CollectionManagerAction | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteUndo, setDeleteUndo] = useState<CollectionDeleteUndoState | null>(null);

  const finishCommittedAction = useCallback(
    async (successMessage: string, reportInManager = true): Promise<void> => {
      const refreshFailure = await refreshLibrary();
      if (!refreshFailure) return;
      const detail = describeSafeError(refreshFailure);
      setMessage(`${successMessage}，但列表刷新失败，可稍后刷新:${detail}`);
      if (reportInManager) {
        setStatus(successMessage);
        setError(`操作已保存，但文件夹列表刷新失败:${detail}`);
      }
      window.dispatchEvent(new Event("aurascholar:library-updated"));
    },
    [refreshLibrary, setMessage],
  );

  const createCollection = useCallback(
    (parentId?: string | null) => {
      if (action) return;
      if (!isDesktopRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const parent = parentId ? collections.find((collection) => collection.id === parentId) : null;
      setPrompt({
        title: parent ? `在「${parent.name}」中新建文件夹` : "新建文件夹",
        label: "文件夹名称",
        placeholder: "例如：Transformer 综述",
        confirmLabel: "创建",
        description: parent
          ? `新文件夹会显示在「${parent.name}」下。`
          : "新文件夹会显示在文件夹树顶层。",
        onSubmit: async (value) => {
          const name = value.trim();
          const startedAt = Date.now();
          setAction({ id: "__create__", kind: "create" });
          setStatus(`正在创建文件夹「${name}」...`);
          setError(null);
          setDeleteUndo(null);
          try {
            const smokeFailure = consumeCollectionSmokeFailure("create");
            if (smokeFailure) {
              await waitForCollectionMinimumElapsed(startedAt);
              throw smokeFailure;
            }
            const id = await createLibraryCollection(name, parent?.id ?? null);
            await waitForCollectionMinimumElapsed(startedAt);
            activateCollection(id, "create");
            const successMessage = parent
              ? `已在「${parent.name}」中新建「${name}」`
              : `已新建文件夹「${name}」`;
            setMessage(successMessage);
            setStatus(successMessage);
            await finishCommittedAction(successMessage);
          } catch (cause) {
            const promptError = new Error(
              `创建文件夹失败，名称仍保留，可重新创建:${describeSafeError(cause)}`,
            );
            setStatus(null);
            setError(promptError.message);
            throw promptError;
          } finally {
            setAction(null);
          }
        },
      });
    },
    [action, activateCollection, collections, finishCommittedAction, setMessage],
  );

  const renameCollection = useCallback(
    ({ id, name }: Pick<CollectionRow, "id" | "name">) => {
      if (action) return;
      if (!isDesktopRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      setPrompt({
        title: "重命名文件夹",
        label: "文件夹名称",
        initialValue: name,
        confirmLabel: "保存",
        onSubmit: async (value) => {
          const next = value.trim();
          if (next === name) return;
          const startedAt = Date.now();
          setAction({ id, kind: "rename" });
          setStatus(`正在重命名文件夹「${name}」...`);
          setError(null);
          setDeleteUndo(null);
          try {
            const smokeFailure = consumeCollectionSmokeFailure("rename");
            if (smokeFailure) {
              await waitForCollectionMinimumElapsed(startedAt);
              throw smokeFailure;
            }
            await renameLibraryCollection(id, next);
            await waitForCollectionMinimumElapsed(startedAt);
            const successMessage = `已重命名为「${next}」`;
            setMessage(successMessage);
            setStatus(successMessage);
            await finishCommittedAction(successMessage);
          } catch (cause) {
            const promptError = new Error(
              `重命名文件夹失败，名称仍保留，可重新保存:${describeSafeError(cause)}`,
            );
            setStatus(null);
            setError(promptError.message);
            throw promptError;
          } finally {
            setAction(null);
          }
        },
      });
    },
    [action, finishCommittedAction, setMessage],
  );

  const deleteCollection = useCallback(
    async ({ id, name }: Pick<CollectionRow, "id" | "name">) => {
      if (action) return;
      if (!isDesktopRuntime()) {
        setMessage("预览模式下不会写入本地数据库");
        return;
      }
      const childCount = collections.filter((collection) => collection.parent_id === id).length;
      if (childCount > 0) {
        const errorMessage = `无法删除「${name}」：请先移动或删除其中的 ${childCount} 个子文件夹`;
        setMessage(errorMessage);
        setError(errorMessage);
        return;
      }
      const confirmed = await confirm({
        title: "删除文件夹？",
        description: `「${name}」会从文件夹树移除，里面的文献会回到“全部文献”。`,
        details: [
          "文献记录、PDF、批注和标签不会被删除。",
          "删除后可继续通过全部文献或搜索找到这些论文。",
        ],
        confirmLabel: "删除文件夹",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setAction({ id, kind: "delete" });
      setStatus(`正在删除文件夹「${name}」...`);
      setError(null);
      try {
        const smokeFailure = consumeCollectionSmokeFailure("delete");
        if (smokeFailure) {
          await waitForCollectionMinimumElapsed(startedAt);
          throw smokeFailure;
        }
        const { workIds } = await deleteLibraryCollection(id);
        await waitForCollectionMinimumElapsed(startedAt);
        if (activeCollection === id) clearActiveCollection();
        const undoMessage = `已删除文件夹「${name}」`;
        setDeleteUndo({
          id,
          name,
          workIds,
          wasActive: activeCollection === id,
          message: undoMessage,
        });
        setMessage(undoMessage);
        setStatus(undoMessage);
        await finishCommittedAction(undoMessage);
      } catch (cause) {
        const errorMessage = `删除文件夹失败，文件夹仍保留，可重新删除:${describeSafeError(cause)}`;
        setMessage(errorMessage);
        setStatus(null);
        setError(errorMessage);
      } finally {
        setAction(null);
      }
    },
    [
      action,
      activeCollection,
      clearActiveCollection,
      collections,
      confirm,
      finishCommittedAction,
      setMessage,
    ],
  );

  const restoreDeletedCollection = useCallback(async () => {
    if (!deleteUndo || action) return;
    if (!isDesktopRuntime()) {
      setStatus("预览模式下不会写入本地数据库");
      return;
    }
    const { id, name, wasActive, workIds } = deleteUndo;
    const startedAt = Date.now();
    setAction({ id, kind: "restore" });
    setStatus(`正在恢复文件夹「${name}」...`);
    setError(null);
    try {
      const smokeFailure = consumeCollectionSmokeFailure("restore");
      if (smokeFailure) {
        await waitForCollectionMinimumElapsed(startedAt);
        throw smokeFailure;
      }
      const { skippedWorkIds } = await restoreLibraryCollection(id, workIds);
      await waitForCollectionMinimumElapsed(startedAt);
      const restoredMessage =
        skippedWorkIds.length > 0
          ? `已恢复文件夹「${name}」；${skippedWorkIds.length} 篇文献因已永久删除或后来改放其他文件夹而未恢复原归属`
          : `已恢复文件夹「${name}」`;
      setDeleteUndo(null);
      setMessage(restoredMessage);
      setStatus(restoredMessage);
      if (wasActive) activateCollection(id, "restore");
      await finishCommittedAction(restoredMessage);
    } catch (cause) {
      const errorMessage = `恢复文件夹失败，撤销入口仍保留，可重新撤销:${describeSafeError(cause)}`;
      setMessage(errorMessage);
      setStatus(deleteUndo.message);
      setError(errorMessage);
    } finally {
      setAction(null);
    }
  }, [action, activateCollection, deleteUndo, finishCommittedAction, setMessage]);

  const moveCollection = useCallback(
    async ({ id, parentId, position }: MoveCollectionEventDetail) => {
      const folder = collections.find((collection) => collection.id === id);
      if (!folder) return;
      if (!isDesktopRuntime()) {
        previewMoveCollection({ id, parentId, position });
        setMessage(`已移动文件夹「${folder.name}」`);
        return;
      }
      try {
        await moveLibraryCollection(id, parentId, position);
        const successMessage = `已移动文件夹「${folder.name}」`;
        setMessage(successMessage);
        await finishCommittedAction(successMessage, false);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      } catch (cause) {
        setMessage(`移动文件夹失败，原有层级未改变:${describeSafeError(cause)}`);
        window.dispatchEvent(new Event("aurascholar:library-updated"));
      }
    },
    [collections, finishCommittedAction, previewMoveCollection, setMessage],
  );

  const openManager = useCallback(() => {
    setStatus(null);
    setError(null);
    setDeleteUndo(null);
    setManagerOpen(true);
  }, []);

  const closeManager = useCallback(() => {
    if (action) return;
    setManagerOpen(false);
    setStatus(null);
    setError(null);
    setDeleteUndo(null);
  }, [action]);

  const selectFromManager = useCallback(
    (target: CollectionManagerViewTarget) => {
      if (action) return;
      setDeleteUndo(null);
      selectManagerView(target);
      setManagerOpen(false);
    },
    [action, selectManagerView],
  );

  const selectAllFromManager = useCallback(
    () => selectFromManager({ kind: "all" }),
    [selectFromManager],
  );
  const selectTrashFromManager = useCallback(
    () => selectFromManager({ kind: "trash" }),
    [selectFromManager],
  );
  const selectCollectionFromManager = useCallback(
    (collectionId: string) => selectFromManager({ kind: "collection", collectionId }),
    [selectFromManager],
  );

  useEffect(() => {
    const onCreate = (event: Event) => {
      const detail = (event as CustomEvent<CreateCollectionEventDetail>).detail;
      createCollection(detail?.parentId ?? null);
    };
    const onManage = () => openManager();
    const onMove = (event: Event) => {
      const detail = (event as CustomEvent<MoveCollectionEventDetail>).detail;
      if (detail?.id) void moveCollection(detail);
    };
    const onRename = (event: Event) => {
      const detail = (event as CustomEvent<CollectionContextActionEventDetail>).detail;
      if (detail?.id) renameCollection(detail);
    };
    const onDelete = (event: Event) => {
      const detail = (event as CustomEvent<CollectionContextActionEventDetail>).detail;
      if (detail?.id) void deleteCollection(detail);
    };
    window.addEventListener(LIBRARY_COLLECTION_EVENTS.create, onCreate);
    window.addEventListener(LIBRARY_COLLECTION_EVENTS.manage, onManage);
    window.addEventListener(LIBRARY_COLLECTION_EVENTS.move, onMove);
    window.addEventListener(LIBRARY_COLLECTION_EVENTS.rename, onRename);
    window.addEventListener(LIBRARY_COLLECTION_EVENTS.delete, onDelete);
    return () => {
      window.removeEventListener(LIBRARY_COLLECTION_EVENTS.create, onCreate);
      window.removeEventListener(LIBRARY_COLLECTION_EVENTS.manage, onManage);
      window.removeEventListener(LIBRARY_COLLECTION_EVENTS.move, onMove);
      window.removeEventListener(LIBRARY_COLLECTION_EVENTS.rename, onRename);
      window.removeEventListener(LIBRARY_COLLECTION_EVENTS.delete, onDelete);
    };
  }, [createCollection, deleteCollection, moveCollection, openManager, renameCollection]);

  return {
    action,
    deleteUndo,
    error,
    managerOpen,
    prompt,
    status,
    closeManager,
    closePrompt: () => setPrompt(null),
    createCollection,
    deleteCollection,
    moveCollection,
    openManager,
    renameCollection,
    restoreDeletedCollection,
    selectAllFromManager,
    selectCollectionFromManager,
    selectTrashFromManager,
  };
}

type CollectionSmokeFailureKind = "create" | "delete" | "rename" | "restore";

function consumeCollectionSmokeFailure(kind: CollectionSmokeFailureKind): Error | null {
  const smokeFlags = window as LibraryCollectionSmokeFlags;
  const key = {
    create: "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_CREATE__",
    delete: "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_DELETE__",
    rename: "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RENAME__",
    restore: "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_COLLECTION_RESTORE__",
  }[kind] as keyof LibraryCollectionSmokeFlags;
  const message = smokeFlags[key];
  if (typeof message !== "string" || !message) return null;
  delete smokeFlags[key];
  return new Error(message);
}

async function waitForCollectionMinimumElapsed(startedAt: number): Promise<void> {
  const remaining = MIN_COLLECTION_ACTION_BUSY_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}
