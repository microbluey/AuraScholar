import { describe, expect, it } from "vitest";
import { estimateVectorIndexCapacity, fitsVectorIndexQuota } from "./vector-capacity";

describe("vector index capacity planning", () => {
  it("accounts for vector payload, index overhead, and per-unit metadata", () => {
    const estimate = estimateVectorIndexCapacity({
      contentUnitCount: 100,
      dimension: 768,
      precision: "float32",
    });

    expect(estimate).toEqual({
      contentUnitCount: 100,
      dimension: 768,
      precision: "float32",
      bytesPerVector: 3_072,
      rawVectorBytes: 307_200,
      indexOverheadBytes: 153_600,
      metadataBytes: 19_200,
      totalBytes: 480_000,
    });
  });

  it("models compressed storage independently from the embedding dimension", () => {
    const estimate = estimateVectorIndexCapacity({
      contentUnitCount: 4,
      dimension: 384,
      precision: "int8",
      indexOverheadRatio: 0,
      metadataBytesPerUnit: 0,
    });

    expect(estimate.bytesPerVector).toBe(384);
    expect(estimate.totalBytes).toBe(1_536);
    expect(fitsVectorIndexQuota(estimate, 1_536)).toBe(true);
    expect(fitsVectorIndexQuota(estimate, 1_535)).toBe(false);
  });

  it("rejects invalid planning inputs before returning an estimate", () => {
    expect(() =>
      estimateVectorIndexCapacity({ contentUnitCount: -1, dimension: 768, precision: "float32" }),
    ).toThrow("ContentUnit count");
    expect(() =>
      estimateVectorIndexCapacity({ contentUnitCount: 1, dimension: 0, precision: "float32" }),
    ).toThrow("Embedding dimension");
    expect(() => fitsVectorIndexQuota({} as never, -1)).toThrow("disk quota");
  });
});
