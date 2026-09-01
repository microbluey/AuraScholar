/** Shared bounds for main-owned Library scope snapshots crossing IPC. */
export const MAX_LIBRARY_SCOPE_ID_BYTES = 512;
export const MAX_LIBRARY_SCOPE_TOKEN_BYTES = 128;

const utf8Encoder = new TextEncoder();

export function libraryScopeUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}
