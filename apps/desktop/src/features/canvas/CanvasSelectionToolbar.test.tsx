import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasSelectionToolbar } from "./CanvasSelectionToolbar";

describe("CanvasSelectionToolbar", () => {
  it("keeps arrange discoverable when the selected cards are not layout-compatible", () => {
    const layoutHint = "自动整理目前仅支持文献卡片。";
    const markup = renderToStaticMarkup(
      <CanvasSelectionToolbar
        canCitationLayout={false}
        citationLayoutBusy={false}
        citationLayoutHint=""
        canGroup={false}
        canLayout={false}
        canTimelineLayout={false}
        canSynthesize={false}
        layoutHint={layoutHint}
        onGroup={vi.fn()}
        onLayout={vi.fn()}
        onSynthesize={vi.fn()}
        selectedCount={2}
        timelineLayoutHint="仅支持文献卡片"
      />,
    );

    expect(markup).toContain('data-canvas-selection-layout-trigger="true"');
    expect(markup).toContain(`title="${layoutHint}"`);
    expect(markup).toContain("<span>整理</span>");
  });

  it("does not render a contextual toolbar for a single selected card", () => {
    const markup = renderToStaticMarkup(
      <CanvasSelectionToolbar
        canCitationLayout={false}
        citationLayoutBusy={false}
        citationLayoutHint=""
        canGroup={false}
        canLayout={false}
        canTimelineLayout={false}
        canSynthesize={false}
        layoutHint=""
        onGroup={vi.fn()}
        onLayout={vi.fn()}
        onSynthesize={vi.fn()}
        selectedCount={1}
        timelineLayoutHint=""
      />,
    );

    expect(markup).toBe("");
  });
});
