// Change-log entry format. One entry per row mutation; column values carry
// per-field HLC stamps so two devices editing different fields of the same
// row both win.

export interface ChangeEntry {
  /** Sequence number local to the originating device (monotonic). */
  seq: number;
  table: string;
  rowId: string;
  op: "upsert" | "delete";
  /** Column → value at write time. Empty for deletes. */
  values: Record<string, unknown>;
  /** Column → HLC stamp of the write. */
  columnHlcs: Record<string, string>;
  /** HLC of the overall change (max of columnHlcs). */
  hlc: string;
  deviceId: string;
}

/** Journal segment: a batch of entries from one device, stored remotely as JSONL. */
export interface JournalSegment {
  deviceId: string;
  startSeq: number;
  endSeq: number;
  entries: ChangeEntry[];
}

export function segmentPath(deviceId: string, startSeq: number, endSeq: number): string {
  // Zero-padded so lexicographic listing equals numeric ordering.
  return `journal/${deviceId}/${String(startSeq).padStart(12, "0")}-${String(endSeq).padStart(12, "0")}.jsonl`;
}

export function parseSegmentPath(
  path: string,
): { deviceId: string; startSeq: number; endSeq: number } | null {
  const m = path.match(/^journal\/([^/]+)\/(\d+)-(\d+)\.jsonl$/);
  if (!m) return null;
  return { deviceId: m[1]!, startSeq: Number(m[2]), endSeq: Number(m[3]) };
}

export function encodeSegment(segment: JournalSegment): Uint8Array {
  const lines = segment.entries.map((e) => JSON.stringify(e)).join("\n");
  return new TextEncoder().encode(lines);
}

export function decodeSegment(data: Uint8Array): ChangeEntry[] {
  const text = new TextDecoder().decode(data).trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line) as ChangeEntry);
}
