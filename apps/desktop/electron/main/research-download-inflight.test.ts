import { describe, expect, it } from "vitest";
import { createResearchDownloadInFlightGate } from "./research-download-inflight";

describe("research download in-flight gate", () => {
  it("rejects invalid and oversized admissions before they reserve capacity", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 2,
      maxBytes: 10,
      maxDownloadBytes: 6,
    });

    expect(gate.admit(-1)).toBeNull();
    expect(gate.admit(1.5)).toBeNull();
    expect(gate.admit(Number.NaN)).toBeNull();
    expect(gate.admit(Number.POSITIVE_INFINITY)).toBeNull();
    expect(gate.admit(7)).toBeNull();
    expect(gate.admit(6)).not.toBeNull();
  });

  it("reserves one whole file for an unknown transfer length", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 3,
      maxBytes: 10,
      maxDownloadBytes: 6,
    });

    const unknown = gate.admit(0);
    expect(unknown).not.toBeNull();
    expect(gate.admit(5)).toBeNull();
    unknown?.release();
    expect(gate.admit(5)).not.toBeNull();
  });

  it("enforces both the concurrent count and aggregate reservation limits", () => {
    const countGate = createResearchDownloadInFlightGate({
      maxDownloads: 1,
      maxBytes: 20,
      maxDownloadBytes: 10,
    });
    expect(countGate.admit(1)).not.toBeNull();
    expect(countGate.admit(1)).toBeNull();

    const byteGate = createResearchDownloadInFlightGate({
      maxDownloads: 3,
      maxBytes: 10,
      maxDownloadBytes: 10,
    });
    expect(byteGate.admit(6)).not.toBeNull();
    expect(byteGate.admit(5)).toBeNull();
  });

  it("expands known transfers monotonically when the global budget allows it", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 2,
      maxBytes: 12,
      maxDownloadBytes: 10,
    });
    const permit = gate.admit(4);
    const other = gate.admit(5);

    expect(permit?.observe(4, 7)).toBe(true);
    expect(gate.admit(1)).toBeNull();
    expect(permit?.observe(4, 4)).toBe(true);
    other?.release();
    permit?.release();
    expect(gate.admit(10)).not.toBeNull();
  });

  it("fails closed and latches when progress is invalid or cannot expand", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 2,
      maxBytes: 10,
      maxDownloadBytes: 8,
    });
    const permit = gate.admit(4);
    const other = gate.admit(5);

    expect(permit?.observe(6, 6)).toBe(false);
    expect(permit?.observe(1, 4)).toBe(false);
    permit?.release();
    other?.release();

    const invalidProgress = gate.admit(4);
    expect(invalidProgress?.observe(5, 4)).toBe(false);
    expect(invalidProgress?.observe(4, 4)).toBe(false);
  });

  it("rejects malformed counters and transfers over the file limit", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 3,
      maxBytes: 20,
      maxDownloadBytes: 8,
    });

    const invalid = gate.admit(4);
    expect(invalid?.observe(-1, 4)).toBe(false);
    const tooLarge = gate.admit(4);
    expect(tooLarge?.observe(9, 0)).toBe(false);
    const oversizedTotal = gate.admit(4);
    expect(oversizedTotal?.observe(4, 9)).toBe(false);
  });

  it("releases capacity exactly once", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 1,
      maxBytes: 10,
      maxDownloadBytes: 10,
    });
    const permit = gate.admit(10);

    permit?.release();
    permit?.release();
    expect(gate.admit(10)).not.toBeNull();
  });

  it("clears active permits without allowing old releases to affect a new cycle", () => {
    const gate = createResearchDownloadInFlightGate({
      maxDownloads: 1,
      maxBytes: 10,
      maxDownloadBytes: 10,
    });
    const oldPermit = gate.admit(10);

    gate.clear();
    const newPermit = gate.admit(10);
    oldPermit?.release();

    expect(oldPermit?.observe(1, 10)).toBe(false);
    expect(gate.admit(1)).toBeNull();
    newPermit?.release();
    expect(gate.admit(10)).not.toBeNull();
  });

  it("rejects invalid configuration", () => {
    expect(() => createResearchDownloadInFlightGate({ maxDownloads: 0 })).toThrow(
      "Research download in-flight count limit",
    );
    expect(() => createResearchDownloadInFlightGate({ maxBytes: 1.5 })).toThrow(
      "Research download in-flight byte limit",
    );
    expect(() => createResearchDownloadInFlightGate({ maxDownloadBytes: -1 })).toThrow(
      "Research download byte limit",
    );
  });
});
