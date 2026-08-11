import type { SnippetWithWork } from "@aurascholar/db/repos/snippets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSnippet,
  deleteSnippet,
  listAllSnippets,
  restoreSnippet,
  updateSnippetNote,
} from "./snippets";

function snippet(overrides: Partial<SnippetWithWork> = {}): SnippetWithWork {
  return {
    created_at: 1,
    id: "snippet-1",
    note_md: null,
    page_index: 2,
    quote: "Excerpt",
    tag: null,
    updated_at: 1,
    work_id: "work-1",
    work_title: "Source work",
    ...overrides,
  };
}

describe("snippet data facade", () => {
  const command = vi.fn();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } }, dispatchEvent },
    });
  });

  it("creates snippets through the main-scoped command and publishes the existing update event", async () => {
    command.mockResolvedValueOnce({ snippetId: "snippet-1" });

    await expect(
      addSnippet({
        noteMd: "Note",
        pageIndex: 2,
        quote: "Excerpt",
        tag: "method",
        workId: "work-1",
      }),
    ).resolves.toBeUndefined();

    expect(command).toHaveBeenCalledWith("snippet.create", {
      noteMd: "Note",
      pageIndex: 2,
      quote: "Excerpt",
      tag: "method",
      workId: "work-1",
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "aurascholar:snippets-updated" }),
    );
  });

  it("lists snippets through the active-library typed command", async () => {
    const rows = [snippet()];
    command.mockResolvedValueOnce({ snippets: rows });

    await expect(listAllSnippets()).resolves.toBe(rows);
    expect(command).toHaveBeenCalledWith("snippet.listAll", {});
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("routes note, soft-delete, and restore mutations through typed commands", async () => {
    command
      .mockResolvedValueOnce({ updated: 1 })
      .mockResolvedValueOnce({ updated: 1 })
      .mockResolvedValueOnce({ updated: 1 });

    await expect(updateSnippetNote("snippet-1", "Revised note")).resolves.toBeUndefined();
    await expect(deleteSnippet("snippet-1")).resolves.toBeUndefined();
    await expect(restoreSnippet("snippet-1")).resolves.toBeUndefined();

    expect(command).toHaveBeenNthCalledWith(1, "snippet.updateNote", {
      noteMd: "Revised note",
      snippetId: "snippet-1",
    });
    expect(command).toHaveBeenNthCalledWith(2, "snippet.delete", { snippetId: "snippet-1" });
    expect(command).toHaveBeenNthCalledWith(3, "snippet.restore", { snippetId: "snippet-1" });
    expect(dispatchEvent).toHaveBeenCalledTimes(3);
  });

  it("preserves main-process failures without publishing an update event", async () => {
    const failure = new Error("snippet mutation failed");
    command.mockRejectedValueOnce(failure);

    await expect(deleteSnippet("snippet-1")).rejects.toBe(failure);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
