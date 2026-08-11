import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isApplePlatform } from "../../shortcut-labels";
import { LibraryInlineSearch } from "./LibraryInlineSearch";

function renderSearch(search: string): string {
  return renderToStaticMarkup(
    <LibraryInlineSearch
      findShortcut="⌘ F"
      isTrashView={false}
      search={search}
      onClear={vi.fn()}
      onSearchChange={vi.fn()}
      onSearchKeyDown={vi.fn()}
    />,
  );
}

describe("LibraryInlineSearch", () => {
  it("exposes the platform find shortcut as semantic keyboard help", () => {
    const markup = renderSearch("");

    expect(markup).toContain('<kbd id="library-inline-search-shortcut"');
    expect(markup).toContain("⌘ F</kbd>");
    expect(markup).toContain(`aria-keyshortcuts="${isApplePlatform() ? "Meta+F" : "Control+F"}"`);
    expect(markup).toContain('aria-describedby="library-inline-search-shortcut"');
    expect(markup).not.toContain('aria-label="清除文献搜索"');
  });

  it("keeps the find shortcut available alongside the clear action for an active query", () => {
    const markup = renderSearch("active query");

    expect(markup).toContain("⌘ F</kbd>");
    expect(markup).toContain("library-inline-search__input--with-clear");
    expect(markup).toContain("library-inline-search__shortcut--with-clear");
    expect(markup).toContain('aria-label="清除文献搜索"');
  });
});
