export interface SmokeWindowLayoutHost {
  isVisible(): boolean;
  showInactive(): void;
}

/**
 * Make the smoke window eligible for compositor layout without taking focus.
 * React Flow populates its handle bounds from visibility-driven measurements,
 * which must happen before a renderer-side readiness check asks for them.
 */
export function prepareSmokeWindowForLayout(win: SmokeWindowLayoutHost): void {
  if (!win.isVisible()) win.showInactive();
}
