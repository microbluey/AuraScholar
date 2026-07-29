export function isCanvasIngressRequestCurrent(
  activeSequence: number,
  requestSequence: number,
  signal?: AbortSignal,
): boolean {
  return activeSequence === requestSequence && !signal?.aborted;
}
