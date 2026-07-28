import { useCallback, useEffect, useRef, useState } from "react";
import type { TagRow } from "@aurascholar/db";
import { useConfirmDialog } from "../../components/ConfirmDialog";
import { isDesktopRuntime } from "../../services/aura-platform";
import {
  createLibraryTag,
  deleteLibraryTag,
  listLibraryTags,
  renameLibraryTag,
  restoreLibraryTag,
  setLibraryTagColor,
} from "../../services/library-organization";
import { describeSafeError } from "../../services/sensitive-text";
import type { TextPromptConfig } from "./TextPromptDialog";

const MIN_TAG_ACTION_BUSY_MS = 450;

interface TagManagerSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__?: string;
  __AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__?: string;
}

export interface TagManagerAction {
  id: string;
  kind: "color" | "create" | "delete" | "rename" | "restore";
}

export interface TagDeleteUndoState {
  id: string;
  name: string;
  workIds: string[];
  message: string;
}

export function useTagManager({
  initialCreate,
  onChanged,
}: {
  initialCreate?: boolean;
  onChanged: () => void;
}) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagPrompt, setTagPrompt] = useState<TextPromptConfig | null>(null);
  const [tagAction, setTagAction] = useState<TagManagerAction | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagDeleteUndo, setTagDeleteUndo] = useState<TagDeleteUndoState | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const initialCreateOpenedRef = useRef(false);
  const tagBusy = tagAction !== null;

  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    if (!isDesktopRuntime()) {
      if (!isCurrent()) return;
      setTags([]);
      setLoading(false);
      return;
    }
    const nextTags = await listLibraryTags();
    if (!isCurrent()) return;
    setTags(nextTags);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadId = window.setTimeout(() => {
      void load(() => !cancelled).catch((loadFailure) => {
        if (cancelled) return;
        setLoading(false);
        setError(`读取标签失败:${describeSafeError(loadFailure)}`);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(loadId);
    };
  }, [load]);

  const finishCommittedAction = useCallback(
    async (startedAt: number, successMessage: string) => {
      await waitForMinimumElapsed(startedAt);
      try {
        await load();
        setError(null);
      } catch (loadFailure) {
        setError(
          `操作已保存，但标签列表刷新失败，可稍后重新打开:${describeSafeError(loadFailure)}`,
        );
      }
      setStatus(successMessage);
      onChanged();
    },
    [load, onChanged],
  );

  const create = useCallback(() => {
    if (tagBusy) return;
    if (!isDesktopRuntime()) {
      setStatus("预览模式下不会写入本地数据库");
      setError(null);
      return;
    }
    setTagPrompt({
      title: "新建标签",
      label: "标签名称",
      placeholder: "例如：方法论、待读、实验复现",
      confirmLabel: "创建标签",
      onSubmit: async (value) => {
        const next = value.trim();
        const startedAt = Date.now();
        setTagAction({ id: "new", kind: "create" });
        setStatus(`正在创建标签「${next}」...`);
        setError(null);
        setTagDeleteUndo(null);
        try {
          await createLibraryTag(next);
          await finishCommittedAction(startedAt, `已创建标签「${next}」`);
        } catch (createFailure) {
          const nextError = new Error(`创建标签失败:${describeSafeError(createFailure)}`);
          setStatus(null);
          setError(nextError.message);
          throw nextError;
        } finally {
          setTagAction(null);
        }
      },
    });
  }, [finishCommittedAction, tagBusy]);

  useEffect(() => {
    if (!initialCreate || loading || initialCreateOpenedRef.current) return;
    const createId = window.setTimeout(() => {
      initialCreateOpenedRef.current = true;
      create();
    }, 0);
    return () => window.clearTimeout(createId);
  }, [create, initialCreate, loading]);

  const rename = useCallback(
    (tag: TagRow) => {
      if (tagBusy) return;
      setTagPrompt({
        title: "重命名标签",
        label: "标签名称",
        initialValue: tag.name,
        confirmLabel: "保存",
        onSubmit: async (value) => {
          const next = value.trim();
          if (next === tag.name) return;
          const startedAt = Date.now();
          setTagAction({ id: tag.id, kind: "rename" });
          setStatus(`正在重命名标签「${tag.name}」...`);
          setError(null);
          setTagDeleteUndo(null);
          try {
            const smokeFailure = consumeSmokeFailure("rename");
            if (smokeFailure) {
              await waitForMinimumElapsed(startedAt);
              throw smokeFailure;
            }
            await renameLibraryTag(tag.id, next);
            await finishCommittedAction(startedAt, `已重命名为「${next}」`);
          } catch (renameFailure) {
            const nextError = new Error(
              `重命名标签失败，名称仍保留，可重新保存:${describeSafeError(renameFailure)}`,
            );
            setStatus(null);
            setError(nextError.message);
            throw nextError;
          } finally {
            setTagAction(null);
          }
        },
      });
    },
    [finishCommittedAction, tagBusy],
  );

  const recolor = useCallback(
    (tag: TagRow) => {
      if (tagBusy) return;
      setTagPrompt({
        title: "设置标签颜色",
        label: "选择标签颜色",
        initialValue: tag.color ?? "",
        confirmLabel: "保存",
        description: "选择一种预设颜色，或使用系统取色器创建自己的颜色。",
        allowEmpty: true,
        inputKind: "color",
        onSubmit: async (value) => {
          const next = value.trim();
          const startedAt = Date.now();
          setTagAction({ id: tag.id, kind: "color" });
          setStatus(`正在更新标签「${tag.name}」的颜色...`);
          setError(null);
          setTagDeleteUndo(null);
          try {
            await setLibraryTagColor(tag.id, next || null);
            await finishCommittedAction(
              startedAt,
              next ? `已更新标签「${tag.name}」的颜色` : `已清除标签「${tag.name}」的颜色`,
            );
          } catch (colorFailure) {
            setError(`更新标签颜色失败:${describeSafeError(colorFailure)}`);
            throw colorFailure;
          } finally {
            setTagAction(null);
          }
        },
      });
    },
    [finishCommittedAction, tagBusy],
  );

  const remove = useCallback(
    async (tag: TagRow) => {
      if (tagBusy) return;
      const confirmed = await confirm({
        title: "删除标签？",
        description: `「${tag.name}」会从 ${tag.count} 篇文献上移除。`,
        details: ["文献本身不会被删除。", "删除后可立即撤销并恢复原有标注。"],
        confirmLabel: "删除标签",
        tone: "warning",
      });
      if (!confirmed) return;
      const startedAt = Date.now();
      setTagAction({ id: tag.id, kind: "delete" });
      setStatus(`正在删除标签「${tag.name}」...`);
      setError(null);
      try {
        const smokeFailure = consumeSmokeFailure("delete");
        if (smokeFailure) {
          await waitForMinimumElapsed(startedAt);
          throw smokeFailure;
        }
        const { workIds } = await deleteLibraryTag(tag.id);
        const message = `已删除标签「${tag.name}」`;
        setTagDeleteUndo({ id: tag.id, name: tag.name, workIds, message });
        await finishCommittedAction(startedAt, message);
      } catch (deleteFailure) {
        setStatus(null);
        setError(`删除标签失败，标签仍保留，可重新删除:${describeSafeError(deleteFailure)}`);
      } finally {
        setTagAction(null);
      }
    },
    [confirm, finishCommittedAction, tagBusy],
  );

  const undoDelete = useCallback(async () => {
    if (!tagDeleteUndo || tagBusy) return;
    const { id, name, workIds } = tagDeleteUndo;
    const startedAt = Date.now();
    setTagAction({ id, kind: "restore" });
    setStatus(`正在恢复标签「${name}」...`);
    setError(null);
    try {
      const smokeFailure = consumeSmokeFailure("restore");
      if (smokeFailure) {
        await waitForMinimumElapsed(startedAt);
        throw smokeFailure;
      }
      await restoreLibraryTag(id, workIds);
      await finishCommittedAction(startedAt, `已恢复标签「${name}」`);
      setTagDeleteUndo(null);
    } catch (restoreFailure) {
      setStatus(tagDeleteUndo.message);
      setError(`恢复标签失败，撤销入口仍保留，可重新撤销:${describeSafeError(restoreFailure)}`);
    } finally {
      setTagAction(null);
    }
  }, [finishCommittedAction, tagBusy, tagDeleteUndo]);

  return {
    closePrompt: () => setTagPrompt(null),
    confirmDialog,
    create,
    error,
    loading,
    recolor,
    remove,
    rename,
    status,
    tagAction,
    tagBusy,
    tagDeleteUndo,
    tagPrompt,
    tags,
    undoDelete,
  };
}

async function waitForMinimumElapsed(startedAt: number): Promise<void> {
  const remaining = MIN_TAG_ACTION_BUSY_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function consumeSmokeFailure(kind: "delete" | "rename" | "restore"): Error | null {
  const smokeWindow = window as TagManagerSmokeWindow;
  const key =
    kind === "delete"
      ? "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_DELETE__"
      : kind === "rename"
        ? "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RENAME__"
        : "__AURASCHOLAR_SMOKE_LIBRARY_FAIL_NEXT_TAG_RESTORE__";
  const message = smokeWindow[key];
  if (!message) return null;
  delete smokeWindow[key];
  return new Error(message);
}
