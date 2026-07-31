import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LibraryBulkActionBar, type LibraryBulkActionBarProps } from "./LibraryBulkActionBar";

function props(
  overrides: Partial<LibraryBulkActionBarProps> = {},
): LibraryBulkActionBarProps {
  return {
    busy: false,
    citationBusy: null,
    isTrashView: false,
    onAddTag: vi.fn(),
    onAddToProject: vi.fn(),
    onClear: vi.fn(),
    onCopyBibliography: vi.fn(),
    onDelete: vi.fn(),
    onExportCitations: vi.fn(),
    onMerge: vi.fn(),
    onMoveToCollection: vi.fn(),
    onPurge: vi.fn(),
    onRestore: vi.fn(),
    selectedCount: 2,
    workActionBusy: null,
    ...overrides,
  };
}

describe("LibraryBulkActionBar", () => {
  it("exposes Project intake for actionable Library selections", () => {
    const markup = renderToStaticMarkup(<LibraryBulkActionBar {...props()} />);

    expect(markup).toContain("已选 2 篇");
    expect(markup).toContain("加入项目");
    expect(markup).toContain("合并文献");
  });

  it("keeps Project intake and citation actions out of the recycle bin", () => {
    const markup = renderToStaticMarkup(
      <LibraryBulkActionBar {...props({ isTrashView: true, selectedCount: 1 })} />,
    );

    expect(markup).toContain("恢复");
    expect(markup).toContain("永久删除");
    expect(markup).not.toContain("加入项目");
    expect(markup).not.toContain("导出引用");
  });

  it("shows merge only for multi-selection", () => {
    const markup = renderToStaticMarkup(
      <LibraryBulkActionBar {...props({ selectedCount: 1 })} />,
    );

    expect(markup).not.toContain("合并文献");
  });
});
