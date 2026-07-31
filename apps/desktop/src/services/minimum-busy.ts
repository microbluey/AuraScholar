/** Keeps short async actions visible long enough for users to perceive feedback. */
export async function waitForMinimumElapsed(
  startedAt: number,
  minimumMs: number,
): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
