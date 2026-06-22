// The preload bridge (electron/preload.ts) exposes its API on window.aura.
// Importing the type keeps the renderer in lockstep with the bridge surface.
import type { AuraApi } from "../electron/preload";

declare global {
  interface Window {
    aura: AuraApi;
  }
}

export {};
