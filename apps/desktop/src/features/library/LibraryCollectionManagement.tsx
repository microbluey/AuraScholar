import type { CollectionRow } from "@aurascholar/db";
import type { ConfirmFunction } from "../../components/ConfirmDialog";
import { CollectionManager } from "./CollectionManager";
import { TextPromptDialog } from "./TextPromptDialog";
import {
  useLibraryCollectionController,
  type CollectionActivationReason,
  type CollectionManagerViewTarget,
} from "./useLibraryCollectionController";
import type { MoveCollectionEventDetail } from "./library-collection-model";

interface LibraryCollectionManagementProps {
  activeCollection: string | null;
  collections: CollectionRow[];
  confirm: ConfirmFunction;
  isTrashView: boolean;
  trashCount: number;
  activateCollection: (id: string, reason: CollectionActivationReason) => void;
  clearActiveCollection: () => void;
  previewMoveCollection: (detail: MoveCollectionEventDetail) => void;
  refreshLibrary: () => Promise<void | Error>;
  selectManagerView: (target: CollectionManagerViewTarget) => void;
  setMessage: (message: string) => void;
}

export function LibraryCollectionManagement(props: LibraryCollectionManagementProps) {
  const controller = useLibraryCollectionController(props);
  const statusAction =
    controller.deleteUndo &&
    (controller.status === controller.deleteUndo.message || controller.action?.kind === "restore")
      ? {
          ariaLabel: "撤销删除文件夹",
          busy: controller.action?.kind === "restore",
          label: controller.action?.kind === "restore" ? "撤销中..." : "撤销",
          onClick: () => void controller.restoreDeletedCollection(),
        }
      : null;

  return (
    <>
      {controller.managerOpen && (
        <CollectionManager
          collections={props.collections}
          activeCollection={props.activeCollection}
          action={controller.action}
          status={controller.status}
          statusAction={statusAction}
          error={controller.error}
          trashCount={props.trashCount}
          isTrashView={props.isTrashView}
          onClose={controller.closeManager}
          onSelectAll={controller.selectAllFromManager}
          onSelectTrash={controller.selectTrashFromManager}
          onSelectCollection={controller.selectCollectionFromManager}
          onCreate={controller.createCollection}
          onRename={controller.renameCollection}
          onDelete={(collection) => void controller.deleteCollection(collection)}
        />
      )}

      {controller.prompt && (
        <TextPromptDialog config={controller.prompt} onClose={controller.closePrompt} />
      )}
    </>
  );
}
