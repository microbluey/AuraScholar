/**
 * Runtime limits shared by the main-process save adapter and renderer decoder.
 * DB read-side limits are asserted against these values in codec tests.
 */
export const MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CANVAS_WORKSPACE_LIST_BYTES = 8 * 1024 * 1024;
export const MAX_CANVAS_WORKSPACE_LIST_ROWS = 1_000;
export const MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES = 64 * 1024;
export const MAX_CANVAS_WORKSPACE_NAME_BYTES = 512;
/** Matches the byte preflight applied to persisted Canvas identifier columns. */
export const MAX_CANVAS_RECORD_ID_BYTES = 512;
/** Matches the historical main-process input contract for IDs nested in JSON data. */
export const MAX_CANVAS_DATA_RECORD_ID_LENGTH = 512;
export const MAX_CANVAS_NODES = 2_000;
export const MAX_CANVAS_EDGES = 5_000;
export const MAX_CANVAS_NODE_TAGS = 64;
export const MAX_CANVAS_NODE_TAG_BYTES = 512;
export const MAX_CANVAS_EDGE_LABEL_BYTES = 16 * 1024;
export const MAX_CANVAS_JSON_TEXT_BYTES = 1024 * 1024;
export const MAX_CANVAS_JSON_COLLECTION_ITEMS = 10_000;
export const MAX_CANVAS_JSON_DEPTH = 32;
export const MAX_CANVAS_JSON_KEY_BYTES = 512;

const utf8Encoder = new TextEncoder();

export function canvasUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}
