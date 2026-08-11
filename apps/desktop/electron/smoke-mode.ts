/**
 * The privileged smoke bridge is intentionally unavailable to packaged builds.
 * Main grants the preload bridge with this explicit argument only after it has
 * made that decision, so the renderer never gets to trust an environment
 * variable by itself.
 */
export const SMOKE_PRELOAD_ARGUMENT = "--aurascholar-smoke-bridge";

export function isMainSmokeMode(requested: string | undefined, isPackaged: boolean): boolean {
  return requested === "1" && !isPackaged;
}

export function hasPreloadSmokeBridge(argv: readonly string[]): boolean {
  return argv.includes(SMOKE_PRELOAD_ARGUMENT);
}
