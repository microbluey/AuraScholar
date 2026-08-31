import { MAX_CANVAS_WORKSPACE_LIST_ROWS } from "../../shared/canvas-workspace-document-limits";

/** Maximum number of complete workspaces persisted in the browser-only preview. */
export const MAX_CANVAS_PREVIEW_WORKSPACES = MAX_CANVAS_WORKSPACE_LIST_ROWS;

/**
 * Browser preview stores full workspace documents, unlike the bounded desktop
 * summary list. Keep its aggregate local-storage budget independent.
 */
export const MAX_CANVAS_PREVIEW_ENVELOPE_BYTES = 16 * 1024 * 1024;

/** Rejects values whose UTF-8 representation exceeds the preview storage budget. */
export function assertCanvasPreviewStorageByteLimit(value: string): void {
  if (value.length > MAX_CANVAS_PREVIEW_ENVELOPE_BYTES) {
    throw new Error(
      `Canvas preview storage is limited to ${MAX_CANVAS_PREVIEW_ENVELOPE_BYTES} bytes`,
    );
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      // TextEncoder serializes lone UTF-16 surrogate code units as U+FFFD.
      bytes += 3;
    }
    if (bytes > MAX_CANVAS_PREVIEW_ENVELOPE_BYTES) {
      throw new Error(
        `Canvas preview storage is limited to ${MAX_CANVAS_PREVIEW_ENVELOPE_BYTES} bytes`,
      );
    }
  }
}
