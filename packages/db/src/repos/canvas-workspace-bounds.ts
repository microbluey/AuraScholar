/**
 * Canvas snapshot budgets shared by bounded persistence readers and future
 * command input validators. Values mirror the established workspace write
 * limits without making the database package depend on Electron.
 */
export const MAX_CANVAS_WORKSPACE_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CANVAS_WORKSPACE_LIST_BYTES = 8 * 1024 * 1024;
export const MAX_CANVAS_WORKSPACE_LIST_ROWS = 1_000;
export const MAX_CANVAS_WORKSPACE_DESCRIPTION_BYTES = 64 * 1024;
export const MAX_CANVAS_WORKSPACE_NAME_BYTES = 512;
export const MAX_CANVAS_WORKSPACE_IDENTIFIER_BYTES = 512;
export const MAX_CANVAS_NODES = 2_000;
export const MAX_CANVAS_EDGES = 5_000;
export const MAX_CANVAS_NODE_TAGS = 64;
export const MAX_CANVAS_NODE_TAG_BYTES = 512;
export const MAX_CANVAS_EDGE_LABEL_BYTES = 16 * 1024;
export const MAX_CANVAS_JSON_TEXT_BYTES = 1024 * 1024;
export const MAX_CANVAS_JSON_COLLECTION_ITEMS = 10_000;
export const MAX_CANVAS_JSON_DEPTH = 32;
export const MAX_CANVAS_JSON_KEY_BYTES = 512;

/**
 * JSON may encode a one-byte control character as a six-byte escape. Keep the
 * stored tag payload within the write-side count and per-tag-byte contracts.
 */
export const MAX_CANVAS_NODE_TAGS_JSON_BYTES =
  MAX_CANVAS_NODE_TAGS * (MAX_CANVAS_NODE_TAG_BYTES * 6 + 3) + 2;

/** A stored edge style has one bounded text field plus small JSON structure. */
export const MAX_CANVAS_EDGE_STYLE_JSON_BYTES = MAX_CANVAS_EDGE_LABEL_BYTES * 6 + 128;

/** Enum fields are short; this protects direct or legacy database mutations. */
export const MAX_CANVAS_NODE_TYPE_BYTES = 64;
export const MAX_CANVAS_EDGE_RELATION_BYTES = 64;
