import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_RESEARCH_PRINT_FILE_ATTEMPTS,
  writeResearchPrintedFile,
} from "./research-download-print-file";

describe("research print download file allocation", () => {
  it("keeps an existing file intact and writes a fresh candidate exclusively", () => {
    const root = mkdtempSync(join(tmpdir(), "aurascholar-print-file-"));
    try {
      const directory = join(root, "research-downloads");
      const existingPath = join(directory, "existing.pdf");
      const freshPath = join(directory, "fresh.pdf");
      mkdirSync(directory);
      writeFileSync(existingPath, new Uint8Array([9]));

      const result = writeResearchPrintedFile(root, "page.pdf", new Uint8Array([1, 2]), {
        createFileName: vi
          .fn()
          .mockReturnValueOnce("existing.pdf")
          .mockReturnValueOnce("fresh.pdf"),
      });

      expect(result).toBe("fresh.pdf");
      expect([...readFileSync(existingPath)]).toEqual([9]);
      expect([...readFileSync(freshPath)]).toEqual([1, 2]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries an existing candidate without replacing it", () => {
    const createFileName = vi
      .fn()
      .mockReturnValueOnce("first.pdf")
      .mockReturnValueOnce("second.pdf");
    const pathFor = vi.fn((_root: string, fileName: string) => `/downloads/${fileName}`);
    const writeFile = vi.fn((path: string) => {
      if (path.endsWith("first.pdf")) {
        throw Object.assign(new Error("already exists"), { code: "EEXIST" });
      }
    });

    const result = writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array([1]), {
      createFileName,
      pathFor,
      writeFile,
    });

    expect(result).toBe("second.pdf");
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(pathFor).toHaveBeenNthCalledWith(1, "/user-data", "first.pdf");
    expect(pathFor).toHaveBeenNthCalledWith(2, "/user-data", "second.pdf");
  });

  it("does not retry errors other than an existing file", () => {
    const createFileName = vi.fn(() => "candidate.pdf");
    const writeFile = vi.fn(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    expect(() =>
      writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array(), {
        createFileName,
        pathFor: (_root, fileName) => `/downloads/${fileName}`,
        writeFile,
      }),
    ).toThrow("permission denied");
    expect(createFileName).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it("leaves all existing candidates untouched after bounded retries", () => {
    const createFileName = vi.fn((_: string) => "existing.pdf");
    const writeFile = vi.fn(() => {
      throw Object.assign(new Error("already exists"), { code: "EEXIST" });
    });

    expect(() =>
      writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array(), {
        createFileName,
        pathFor: (_root, fileName) => `/downloads/${fileName}`,
        writeFile,
      }),
    ).toThrow("already exists");
    expect(createFileName).toHaveBeenCalledTimes(MAX_RESEARCH_PRINT_FILE_ATTEMPTS);
    expect(writeFile).toHaveBeenCalledTimes(MAX_RESEARCH_PRINT_FILE_ATTEMPTS);
  });
});
