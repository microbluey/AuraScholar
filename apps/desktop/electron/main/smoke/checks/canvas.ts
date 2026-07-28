import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildCanvasSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "canvas-legacy-flashcards-redirect",
      pass: renderer.canvasLegacyFlashcardsRedirected,
      detail: renderer.canvasLegacyRedirectHash,
    },
    {
      name: "canvas-persisted-node-reload",
      pass:
        renderer.canvasPersistedNodeReloaded &&
        typeof renderer.canvasPersistedNodeCount === "number" &&
        renderer.canvasPersistedNodeCount >= 2,
      detail: `reloaded=${renderer.canvasPersistedNodeReloaded}; count=${renderer.canvasPersistedNodeCount}`,
    },
    {
      name: "canvas-split-reader-workflow",
      pass:
        renderer.canvasSplitReaderOpened &&
        renderer.canvasSplitReaderKeptContext &&
        renderer.canvasSplitReaderExcerptLinked &&
        renderer.canvasSplitReaderClosed &&
        renderer.canvasSplitReaderCleanupSucceeded,
      detail: `opened=${renderer.canvasSplitReaderOpened}; context=${renderer.canvasSplitReaderKeptContext}; linked=${renderer.canvasSplitReaderExcerptLinked}; closed=${renderer.canvasSplitReaderClosed}; cleanup=${renderer.canvasSplitReaderCleanupSucceeded}`,
    },
    {
      name: "canvas-node-context-toolbox-workflow",
      pass:
        renderer.canvasNodeContextMenuVisible &&
        renderer.canvasToolboxDetailsEditPersisted &&
        renderer.canvasNodeKeyboardDeleteHandled &&
        renderer.canvasSplitReaderCleanupSucceeded,
      detail: `menu=${renderer.canvasNodeContextMenuVisible}; edit=${renderer.canvasToolboxDetailsEditPersisted}; keyboardHandled=${renderer.canvasNodeKeyboardDeleteHandled}; delete=${renderer.canvasSplitReaderCleanupSucceeded}`,
    },
    {
      name: "canvas-quick-link-free-text-workflow",
      pass:
        renderer.canvasQuickLinkCreatedImmediately &&
        renderer.canvasQuickLinkUntyped &&
        renderer.canvasQuickLinkLegacyUiAbsent &&
        renderer.canvasQuickLinkEdgeTextEditorOpened &&
        renderer.canvasQuickLinkEdgeTextPersisted &&
        renderer.canvasQuickLinkKeyboardDeleteHandled &&
        renderer.canvasQuickLinkCleanupSucceeded,
      detail: `sourceReady=${renderer.canvasQuickLinkSourceReady}; dropReady=${renderer.canvasQuickLinkDropPointReady}; connectionStarted=${renderer.canvasQuickLinkConnectionStarted}; created=${renderer.canvasQuickLinkCreatedImmediately}; untyped=${renderer.canvasQuickLinkUntyped}; legacyUiAbsent=${renderer.canvasQuickLinkLegacyUiAbsent}; editor=${renderer.canvasQuickLinkEdgeTextEditorOpened}; text=${renderer.canvasQuickLinkEdgeTextPersisted}; keyboardHandled=${renderer.canvasQuickLinkKeyboardDeleteHandled}; cleanup=${renderer.canvasQuickLinkCleanupSucceeded}`,
    },
  ];
}
