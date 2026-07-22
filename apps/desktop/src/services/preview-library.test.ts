import { describe, expect, it } from "vitest";
import { PREVIEW_LIBRARY_WORKS } from "../features/canvas/model";
import { PREVIEW_LIBRARY_WORK_SEEDS } from "./preview-library";

describe("browser preview Library to Canvas ingress", () => {
  it("exposes every Library fixture through the Canvas resolver", () => {
    const canvasIds = new Set(PREVIEW_LIBRARY_WORKS.map((work) => work.id));

    expect(PREVIEW_LIBRARY_WORK_SEEDS.map((work) => work.id)).toEqual([
      "preview-attention",
      "preview-alphafold",
      "preview-sam",
      "preview-scaling-laws",
    ]);
    expect(PREVIEW_LIBRARY_WORK_SEEDS.every((work) => canvasIds.has(work.id))).toBe(true);
    expect(canvasIds.size).toBe(PREVIEW_LIBRARY_WORKS.length);
  });
});
