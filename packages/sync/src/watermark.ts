export function safeSnapshotWatermark(nowMs = Date.now()): number {
  return Math.max(0, nowMs - 1);
}
