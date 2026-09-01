/** Shared main-process and renderer bounds for Citation Graph command payloads. */
export const MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS = 500;
export const MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_CITATION_GRAPH_DOI_BYTES = 2_048;
export const MAX_CITATION_GRAPH_EDGES = 10_000;
export const MAX_CITATION_GRAPH_LIBRARY_ID_BYTES = 512;
export const MAX_CITATION_GRAPH_NODE_ID_BYTES = 512;
export const MAX_CITATION_GRAPH_NODE_TEXT_BYTES = 16 * 1024;
export const MAX_CITATION_GRAPH_NODES = 100;

const utf8Encoder = new TextEncoder();

export function citationGraphUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}
