import type { CanvasNode } from "@aurascholar/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CanvasNodeContextMenu } from "./CanvasNodeContextMenu";

const PAPER: CanvasNode<"paper"> = {
  id: "paper-a",
  type: "paper",
  position: { x: 0, y: 0 },
  dimensions: { width: 320, height: 220 },
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  data: {
    workId: "work-a",
    title: "Paper A",
    authors: ["Author"],
    year: 2024,
    annotationCount: 0,
  },
};

describe("CanvasNodeContextMenu", () => {
  it("keeps an unavailable multi-selection arrange action visible with its reason", () => {
    const arrangeSelectionHint = "请只选择同一层级的文献。";
    const markup = renderToStaticMarkup(
      <CanvasNodeContextMenu
        arrangeSelectionHint={arrangeSelectionHint}
        canArrangeSelection={false}
        canGroupSelection={false}
        hasMultipleSelection
        node={PAPER}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onFocusNode={vi.fn()}
        onGroupSelection={vi.fn()}
        onOpenDetails={vi.fn()}
        onOpenFullReader={vi.fn()}
        onOpenLayoutMenu={vi.fn()}
        onRemoveNode={vi.fn()}
        onSetGroupCollapsed={vi.fn()}
        onUngroup={vi.fn()}
        position={{ x: 10, y: 10 }}
      />,
    );

    expect(markup).toContain('data-canvas-node-action="arrange"');
    expect(markup).toContain("disabled");
    expect(markup).toContain(`title="${arrangeSelectionHint}"`);
    expect(markup).toContain("整理所选卡片…");
  });
});
