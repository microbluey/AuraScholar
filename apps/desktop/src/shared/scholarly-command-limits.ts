/** Shared renderer/main bounds for scholarly command result payloads. */
export const MAX_SCHOLARLY_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_SCHOLARLY_DISCOVERY_RESULTS = 100;
export const MAX_SCHOLARLY_DISCOVERY_RESULT_ID_BYTES = 2 * 1024;
export const MAX_SCHOLARLY_DISCOVERY_ERROR_BYTES = 2 * 1024;
export const MAX_SCHOLARLY_DISCOVERY_PAGE = 10_000;
export const MAX_SCHOLARLY_AUTHOR_COUNT = 100;
export const MAX_SCHOLARLY_AUTHOR_TEXT_BYTES = 2 * 1024;
export const MAX_SCHOLARLY_KEYWORDS = 50;
export const MAX_SCHOLARLY_CSL_JSON_BYTES = 64 * 1024;
export const MAX_SCHOLARLY_CSL_JSON_DEPTH = 8;
export const MAX_SCHOLARLY_CSL_JSON_ENTRIES = 512;
export const MAX_SCHOLARLY_CANDIDATES = 10;
export const MAX_SCHOLARLY_TITLE_BYTES = 16 * 1024;
export const MAX_SCHOLARLY_WORK_LONG_TEXT_BYTES = 128 * 1024;
export const MAX_SCHOLARLY_WORK_SHORT_TEXT_BYTES = 8 * 1024;
export const MAX_SCHOLARLY_URL_BYTES = 8 * 1024;
export const MAX_SCHOLARLY_COUNT = 1_000_000_000;
export const MAX_SCHOLARLY_YEAR = 10_000;

const utf8Encoder = new TextEncoder();

export function scholarlyUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}
