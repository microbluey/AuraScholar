import { describe, expect, it } from "vitest";
import type { CanvasIngressWork } from "../../../electron/data-command-contract";
import type { LibraryListWork } from "../../services/library-list";
import { toCanvasLibraryWork } from "./library-work";

describe("Canvas library-work adapter", () => {
  it("adapts a lightweight list DTO and keeps metadata-search tags", () => {
    const source = {
      abstract: "A canvas-ready abstract",
      authorNames: ["Ada Lovelace"],
      createdAt: 2_000,
      doi: "10.1000/example",
      id: "work-list",
      readingStatus: "reading",
      starred: true,
      tagNames: ["Methods"],
      title: "List DTO",
      venueName: "Journal",
      year: 2026,
    } satisfies LibraryListWork & { tagNames: string[] };

    expect(toCanvasLibraryWork(source)).toEqual({
      abstract: "A canvas-ready abstract",
      authorNames: ["Ada Lovelace"],
      doi: "10.1000/example",
      id: "work-list",
      readingStatus: "reading",
      tags: ["Methods"],
      title: "List DTO",
      venue: "Journal",
      year: 2026,
    });
  });

  it("adapts a narrow Canvas ingress work without database-only fields", () => {
    const source = {
      abstract: null,
      authorNames: ["Grace Hopper"],
      deleted_at: null,
      doi: null,
      id: "work-ingress",
      reading_status: "read",
      title: "Ingress row",
      venue_name: "Proceedings",
      year: 1952,
    } satisfies CanvasIngressWork;

    expect(toCanvasLibraryWork(source)).toEqual({
      abstract: null,
      authorNames: ["Grace Hopper"],
      doi: null,
      id: "work-ingress",
      readingStatus: "read",
      tags: [],
      title: "Ingress row",
      venue: "Proceedings",
      year: 1952,
    });
  });
});
