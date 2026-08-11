import type { KeyboardEventHandler, RefObject } from "react";
import { isApplePlatform } from "../../shortcut-labels";
import "./LibraryInlineSearch.css";

const SEARCH_SHORTCUT_DESCRIPTION_ID = "library-inline-search-shortcut";

export interface LibraryInlineSearchProps {
  findShortcut: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  isTrashView: boolean;
  onClear(): void;
  onSearchChange(value: string): void;
  onSearchKeyDown: KeyboardEventHandler<HTMLInputElement>;
  search: string;
}

/**
 * Keeps the platform-specific find shortcut visible even while a query is active.
 * The clear action and shortcut are separate controls: one mutates the query, while
 * the other describes how to focus/select it from anywhere in the library.
 */
export function LibraryInlineSearch({
  findShortcut,
  inputRef,
  isTrashView,
  onClear,
  onSearchChange,
  onSearchKeyDown,
  search,
}: LibraryInlineSearchProps) {
  const hasSearch = Boolean(search);
  const shortcutKey = isApplePlatform() ? "Meta+F" : "Control+F";

  return (
    <div className="library-inline-search library-inline-search--header">
      <input
        ref={inputRef}
        className={`au-input${hasSearch ? " library-inline-search__input--with-clear" : ""}`}
        aria-describedby={SEARCH_SHORTCUT_DESCRIPTION_ID}
        aria-keyshortcuts={shortcutKey}
        aria-label={isTrashView ? "搜索回收站文献" : "搜索当前文献结果"}
        placeholder={isTrashView ? "搜索回收站" : "在结果中搜索"}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={onSearchKeyDown}
      />
      <kbd
        id={SEARCH_SHORTCUT_DESCRIPTION_ID}
        className={`au-kbd library-inline-search__shortcut${
          hasSearch ? " library-inline-search__shortcut--with-clear" : ""
        }`}
      >
        {findShortcut}
      </kbd>
      {hasSearch && (
        <button
          type="button"
          className="library-inline-search__clear"
          aria-label="清除文献搜索"
          title="清除搜索"
          onClick={onClear}
        >
          ×
        </button>
      )}
    </div>
  );
}
