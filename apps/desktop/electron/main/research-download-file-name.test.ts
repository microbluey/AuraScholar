import { describe, expect, it } from "vitest";
import {
  createResearchDownloadFileName,
  MAX_RESEARCH_DOWNLOAD_FILE_NAME_LENGTH,
} from "./research-download-file-name";

describe("research download temporary filenames", () => {
  it("normalizes unsafe names, keeps an extension, and prefixes a numeric nonce", () => {
    expect(createResearchDownloadFileName("report: final?.pdf", 1_710_000_000_000, "42")).toBe(
      "171000000000000000000000000000042-report--final-.pdf",
    );
  });

  it("bounds long names while preserving a safe extension", () => {
    const fileName = createResearchDownloadFileName(`${"a".repeat(600)}.PDF`, 1, "2");
    expect(fileName.length).toBeLessThanOrEqual(MAX_RESEARCH_DOWNLOAD_FILE_NAME_LENGTH);
    expect(fileName).toMatch(/^100000000000000000002-/u);
    expect(fileName).toMatch(/\.PDF$/u);
  });

  it("preserves every digit of the full 64-bit random nonce", () => {
    expect(createResearchDownloadFileName("paper.pdf", 1, "18446744073709551615")).toBe(
      "118446744073709551615-paper.pdf",
    );
  });

  it("avoids device aliases and distinguishes same-millisecond downloads", () => {
    const first = createResearchDownloadFileName("CON.pdf", 1_710_000_000_000, "1");
    const second = createResearchDownloadFileName("CON.pdf", 1_710_000_000_000, "2");
    expect(first).toContain("-download.pdf");
    expect(second).toContain("-download.pdf");
    expect(first).not.toBe(second);
  });
});
