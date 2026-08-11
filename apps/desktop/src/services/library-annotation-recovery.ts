import type { DataCommandMap } from "../../electron/data-command-contract";

type RestoreAnnotationsForAttachmentCommand =
  DataCommandMap["library.restoreAnnotationsForAttachment"];

/**
 * Reconnect live annotations to a newly attached PDF for the same work.
 * The local-library scope and inactive attachment selection remain main-process
 * concerns so the renderer never obtains a database handle for this repair.
 */
export async function restoreAnnotationsForAttachment(
  workId: string,
  attachmentId: string,
): Promise<number> {
  const result: RestoreAnnotationsForAttachmentCommand["output"] = await window.aura.data.command(
    "library.restoreAnnotationsForAttachment",
    { attachmentId, workId },
  );
  return result.restoredAnnotationCount;
}
