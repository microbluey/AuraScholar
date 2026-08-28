import {
  closeSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_RESEARCH_PRINT_FILE_ATTEMPTS,
  writeResearchPrintedFile,
} from "./research-download-print-file";
import { MAX_RESEARCH_DOWNLOAD_BYTES } from "./research-download-limits";

describe("research print download file allocation", () => {
  it("rejects an oversized print before allocating or writing a temporary file", () => {
    const createFileName = vi.fn(() => "oversized.pdf");
    const pathFor = vi.fn((_root: string, fileName: string) => `/downloads/${fileName}`);
    const openExclusive = vi.fn(() => 7);
    const writeFile = vi.fn();
    const closeFile = vi.fn();
    const removeFile = vi.fn();
    const oversizedPdf = {
      byteLength: MAX_RESEARCH_DOWNLOAD_BYTES + 1,
    } as Uint8Array;

    expect(() =>
      writeResearchPrintedFile("/user-data", "page.pdf", oversizedPdf, {
        createFileName,
        pathFor,
        io: { openExclusive, writeFile, closeFile, removeFile },
      }),
    ).toThrow("Research print file exceeds download size limit");

    expect(createFileName).not.toHaveBeenCalled();
    expect(pathFor).not.toHaveBeenCalled();
    expect(openExclusive).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(closeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("allows a print exactly at the download size limit", () => {
    const maximumPdf = { byteLength: MAX_RESEARCH_DOWNLOAD_BYTES } as Uint8Array;
    const createFileName = vi.fn(() => "limit.pdf");
    const pathFor = vi.fn((_root: string, fileName: string) => `/downloads/${fileName}`);
    const openExclusive = vi.fn(() => 7);
    const writeFile = vi.fn();
    const closeFile = vi.fn();
    const removeFile = vi.fn();

    expect(
      writeResearchPrintedFile("/user-data", "page.pdf", maximumPdf, {
        createFileName,
        pathFor,
        io: { openExclusive, writeFile, closeFile, removeFile },
      }),
    ).toBe("limit.pdf");

    expect(openExclusive).toHaveBeenCalledWith("/downloads/limit.pdf");
    expect(writeFile).toHaveBeenCalledWith(7, maximumPdf);
    expect(closeFile).toHaveBeenCalledWith(7);
    expect(removeFile).not.toHaveBeenCalled();
  });

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
    const openExclusive = vi.fn((path: string) => {
      if (path.endsWith("first.pdf")) {
        throw Object.assign(new Error("already exists"), { code: "EEXIST" });
      }
      return 7;
    });
    const writeFile = vi.fn();
    const closeFile = vi.fn();
    const removeFile = vi.fn();

    const result = writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array([1]), {
      createFileName,
      pathFor,
      io: { openExclusive, writeFile, closeFile, removeFile },
    });

    expect(result).toBe("second.pdf");
    expect(openExclusive).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledOnce();
    expect(closeFile).toHaveBeenCalledWith(7);
    expect(removeFile).not.toHaveBeenCalled();
    expect(pathFor).toHaveBeenNthCalledWith(1, "/user-data", "first.pdf");
    expect(pathFor).toHaveBeenNthCalledWith(2, "/user-data", "second.pdf");
  });

  it("does not retry errors other than an existing file", () => {
    const createFileName = vi.fn(() => "candidate.pdf");
    const openExclusive = vi.fn(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    const writeFile = vi.fn();
    const closeFile = vi.fn();
    const removeFile = vi.fn();

    expect(() =>
      writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array(), {
        createFileName,
        pathFor: (_root, fileName) => `/downloads/${fileName}`,
        io: { openExclusive, writeFile, closeFile, removeFile },
      }),
    ).toThrow("permission denied");
    expect(createFileName).toHaveBeenCalledTimes(1);
    expect(openExclusive).toHaveBeenCalledOnce();
    expect(writeFile).not.toHaveBeenCalled();
    expect(closeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("leaves all existing candidates untouched after bounded retries", () => {
    const createFileName = vi.fn((_: string) => "existing.pdf");
    const openExclusive = vi.fn(() => {
      throw Object.assign(new Error("already exists"), { code: "EEXIST" });
    });
    const writeFile = vi.fn();
    const closeFile = vi.fn();
    const removeFile = vi.fn();

    expect(() =>
      writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array(), {
        createFileName,
        pathFor: (_root, fileName) => `/downloads/${fileName}`,
        io: { openExclusive, writeFile, closeFile, removeFile },
      }),
    ).toThrow("already exists");
    expect(createFileName).toHaveBeenCalledTimes(MAX_RESEARCH_PRINT_FILE_ATTEMPTS);
    expect(openExclusive).toHaveBeenCalledTimes(MAX_RESEARCH_PRINT_FILE_ATTEMPTS);
    expect(writeFile).not.toHaveBeenCalled();
    expect(closeFile).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
  });

  it("removes an owned partial candidate after a write failure", () => {
    const root = mkdtempSync(join(tmpdir(), "aurascholar-print-file-"));
    const writeFailure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    try {
      const directory = join(root, "research-downloads");
      const candidatePath = join(directory, "partial.pdf");
      mkdirSync(directory);

      expect(() =>
        writeResearchPrintedFile(root, "page.pdf", new Uint8Array([1, 2]), {
          createFileName: () => "partial.pdf",
          io: {
            openExclusive: (path) => openSync(path, "wx", 0o600),
            writeFile(handle, pdf) {
              writeFileSync(handle, pdf.subarray(0, 1));
              throw writeFailure;
            },
            closeFile: closeSync,
            removeFile: unlinkSync,
          },
        }),
      ).toThrow(writeFailure);

      expect(existsSync(candidatePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("closes before cleanup without masking the write failure", () => {
    const writeFailure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    const calls: string[] = [];

    expect(() =>
      writeResearchPrintedFile("/user-data", "page.pdf", new Uint8Array(), {
        createFileName: () => "partial.pdf",
        pathFor: (_root, fileName) => `/downloads/${fileName}`,
        io: {
          openExclusive: () => 7,
          writeFile() {
            calls.push("write");
            throw writeFailure;
          },
          closeFile() {
            calls.push("close");
            throw new Error("close failed");
          },
          removeFile() {
            calls.push("remove");
            throw new Error("remove failed");
          },
        },
      }),
    ).toThrow(writeFailure);

    expect(calls).toEqual(["write", "close", "remove"]);
  });
});
