import { describe, expect, it } from "vitest";
import { createReaderPdfReadGate, MAX_CONCURRENT_READER_PDF_READS } from "./reader-pdf-read-gate";

describe("Reader PDF read gate", () => {
  it("admits one bounded Reader PDF materialization at a time", () => {
    const gate = createReaderPdfReadGate();
    const first = gate.admit();
    expect(first).not.toBeNull();
    expect(gate.admit()).toBeNull();

    first?.release();
    expect(gate.admit()).not.toBeNull();
  });

  it("makes admission release idempotent", () => {
    const gate = createReaderPdfReadGate();
    const first = gate.admit();
    if (!first) throw new Error("Expected Reader PDF admission");

    first.release();
    first.release();

    const second = gate.admit();
    expect(second).not.toBeNull();
    expect(gate.admit()).toBeNull();
  });

  it("validates the configured concurrency bound", () => {
    expect(MAX_CONCURRENT_READER_PDF_READS).toBe(1);
    for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => createReaderPdfReadGate(value)).toThrow(
        "Reader PDF concurrent read limit is invalid",
      );
    }
  });
});
