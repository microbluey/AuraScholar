import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReaderEvidenceSelection } from "@aurascholar/reader";
import { SaveEvidencePopover, shouldSubmitEvidenceShortcut } from "./SaveEvidencePopover";

const selection: ReaderEvidenceSelection = {
  anchor: {
    kind: "pdf",
    pageIndex: 1,
    position: { end: 12, start: 4 },
    quads: { pageIndex: 1, rects: [] },
    quote: { exact: "Evidence", prefix: "", suffix: "" },
    version: 1,
  },
  clientRect: { height: 18, width: 70, x: 100, y: 120 },
  exact: "Evidence",
  pageIndex: 1,
};

describe("SaveEvidencePopover", () => {
  it("renders an accessible compact capture dialog with context selected by default", () => {
    const markup = renderToStaticMarkup(
      <SaveEvidencePopover
        evidenceId="evidence-1"
        gateway={{ loadScope: vi.fn(), save: vi.fn() }}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        selection={selection}
        session={{ isCurrent: () => true, signal: new AbortController().signal }}
        source={{
          attachmentId: "attachment-1",
          expectedBlobSha256: "a".repeat(64),
          workId: "work-1",
          workTitle: "A source paper",
        }}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("保存为证据");
    expect(markup).toContain("A source paper · 第 2 页");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("背景");
    expect(markup).toContain("仅存入证据收件箱");
    expect(markup).toContain("⌘/Ctrl + Enter 保存 · Esc 取消");
  });

  it("preserves native Enter behavior for kind buttons and project selects", () => {
    const closest = vi.fn(() => ({ tagName: "BUTTON" }));
    const interactiveTarget = { closest } as unknown as EventTarget;

    expect(
      shouldSubmitEvidenceShortcut({
        ctrlKey: false,
        key: "Enter",
        metaKey: false,
        target: interactiveTarget,
      }),
    ).toBe(false);
    expect(closest).toHaveBeenCalledWith(expect.stringContaining("button, select"));
  });

  it("keeps an explicit modifier shortcut without hijacking other keys", () => {
    const genericTarget = { closest: vi.fn(() => null) } as unknown as EventTarget;

    expect(
      shouldSubmitEvidenceShortcut({
        ctrlKey: true,
        key: "Enter",
        metaKey: false,
        target: genericTarget,
      }),
    ).toBe(true);
    expect(
      shouldSubmitEvidenceShortcut({
        ctrlKey: false,
        key: "ArrowDown",
        metaKey: false,
        target: genericTarget,
      }),
    ).toBe(false);
  });
});
