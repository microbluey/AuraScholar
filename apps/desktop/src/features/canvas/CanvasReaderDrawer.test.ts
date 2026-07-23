import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import type { ReaderAnnotation } from "@aurascholar/reader";
import { describe, expect, it } from "vitest";
import { CANVAS_EXCERPT_DRAG_VERSION } from "./canvas-excerpt-dnd";
import {
  canvasReaderExcerptDragPayload,
  clampCanvasReaderDrawerWidth,
  type CanvasReaderAnnotationPayload,
} from "./CanvasReaderDrawer";

const annotation: ReaderAnnotation = {
  id: "annotation-1",
  type: "highlight",
  color: "#ffd866",
  pageIndex: 2,
  anchor: {
    version: 1,
    pageIndex: 2,
    quote: { exact: "evidence", prefix: "", suffix: "" },
  },
};

describe("CanvasReaderDrawer helpers", () => {
  it("keeps resize bounds valid on narrow and wide viewports", () => {
    expect(clampCanvasReaderDrawerWidth(120, 390)).toBe(360);
    expect(clampCanvasReaderDrawerWidth(900, 390)).toBe(360);
    expect(clampCanvasReaderDrawerWidth(100, 320)).toBe(320);
    expect(clampCanvasReaderDrawerWidth(900, 1_000)).toBe(720);
  });

  it("serializes only the stable canvas drag contract from complete reader metadata", () => {
    const payload: CanvasReaderAnnotationPayload = {
      annotation,
      attachment: {
        id: "attachment-1",
        work_id: "work-1",
      } as AttachmentRow,
      sourceNodeId: "paper-node-1",
      work: {
        id: "work-1",
        title: "Evidence Graphs",
        authorNames: ["Ada Researcher"],
      } as WorkWithAuthors,
      workspaceId: "workspace-1",
    };

    expect(canvasReaderExcerptDragPayload(payload)).toEqual({
      version: CANVAS_EXCERPT_DRAG_VERSION,
      workspaceId: "workspace-1",
      sourceNodeId: "paper-node-1",
      workId: "work-1",
      attachmentId: "attachment-1",
      paperTitle: "Evidence Graphs",
      annotation,
    });
  });
});
