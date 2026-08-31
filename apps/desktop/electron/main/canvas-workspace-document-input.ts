import type { StoredCanvasWorkspaceDocument } from "@aurascholar/db";
import { decodeCanvasWorkspaceDocument } from "../../src/shared/canvas-workspace-document-codec";

/** Main-process storage adapter over the renderer-safe document decoder. */
export function parseCanvasWorkspaceDocument(value: unknown): StoredCanvasWorkspaceDocument {
  return decodeCanvasWorkspaceDocument(value);
}
