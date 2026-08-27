import { describe, expect, it } from "vitest";
import { createResearchDownloadConsumeGate } from "./research-download-consume-gate";

describe("research download consume gate", () => {
  it("enforces both active-consume and aggregate-byte bounds", () => {
    const countGate = createResearchDownloadConsumeGate({ maxConsumes: 1, maxBytes: 10 });
    expect(countGate.admit(4)).not.toBeNull();
    expect(countGate.admit(1)).toBeNull();

    const byteGate = createResearchDownloadConsumeGate({ maxConsumes: 2, maxBytes: 10 });
    expect(byteGate.admit(6)).not.toBeNull();
    expect(byteGate.admit(5)).toBeNull();
    expect(byteGate.admit(-1)).toBeNull();
    expect(byteGate.admit(1.5)).toBeNull();
  });

  it("releases capacity exactly once", () => {
    const gate = createResearchDownloadConsumeGate({ maxConsumes: 1, maxBytes: 10 });
    const admission = gate.admit(10);

    admission?.release();
    admission?.release();
    expect(gate.admit(10)).not.toBeNull();
  });

  it("rejects invalid configuration", () => {
    expect(() => createResearchDownloadConsumeGate({ maxConsumes: 0 })).toThrow(
      "Research download consume count limit",
    );
    expect(() => createResearchDownloadConsumeGate({ maxBytes: 1.5 })).toThrow(
      "Research download consume byte limit",
    );
  });
});
