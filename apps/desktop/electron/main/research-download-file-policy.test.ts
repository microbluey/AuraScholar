import { describe, expect, it } from "vitest";
import { MAX_REFERENCE_IMPORT_INPUT_BYTES } from "./reference-import-limits";
import {
  describeResearchDownloadFile,
  isResearchDownloadTransferWithinLimit,
  researchDownloadByteLimit,
} from "./research-download-file-policy";

describe("research download file byte policy", () => {
  it("applies the reference-import bound to every supported reference suffix", () => {
    for (const extension of [".bib", ".ris", ".nbib", ".enw", ".json", ".txt"]) {
      expect(researchDownloadByteLimit(`1710000000000-export${extension.toUpperCase()}`, 64)).toBe(
        Math.min(64, MAX_REFERENCE_IMPORT_INPUT_BYTES),
      );
      expect(
        researchDownloadByteLimit(
          `1710000000000-export${extension.toUpperCase()}`,
          MAX_REFERENCE_IMPORT_INPUT_BYTES + 1,
        ),
      ).toBe(MAX_REFERENCE_IMPORT_INPUT_BYTES);
    }
  });

  it("retains the general limit for PDFs and unknown extensions", () => {
    const maxDownloadBytes = MAX_REFERENCE_IMPORT_INPUT_BYTES + 1;
    expect(describeResearchDownloadFile("1710000000000-paper.pdf", maxDownloadBytes)).toEqual({
      kind: "pdf",
      maxByteSize: maxDownloadBytes,
    });
    expect(describeResearchDownloadFile("1710000000000-supplement.zip", maxDownloadBytes)).toEqual({
      kind: "ignored",
      maxByteSize: maxDownloadBytes,
    });
  });

  it("allows an unknown transfer length while rejecting reference-limit overflows", () => {
    expect(isResearchDownloadTransferWithinLimit(0, 0, MAX_REFERENCE_IMPORT_INPUT_BYTES)).toBe(
      true,
    );
    expect(
      isResearchDownloadTransferWithinLimit(
        MAX_REFERENCE_IMPORT_INPUT_BYTES,
        MAX_REFERENCE_IMPORT_INPUT_BYTES,
        MAX_REFERENCE_IMPORT_INPUT_BYTES,
      ),
    ).toBe(true);
    expect(
      isResearchDownloadTransferWithinLimit(
        MAX_REFERENCE_IMPORT_INPUT_BYTES + 1,
        0,
        MAX_REFERENCE_IMPORT_INPUT_BYTES,
      ),
    ).toBe(false);
    expect(
      isResearchDownloadTransferWithinLimit(
        0,
        MAX_REFERENCE_IMPORT_INPUT_BYTES + 1,
        MAX_REFERENCE_IMPORT_INPUT_BYTES,
      ),
    ).toBe(false);
  });
});
