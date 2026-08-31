import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeReaderMetadataOutput(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("reader.getWorkPdfCandidates", async () => ({
    pdfAttachments: [],
    work: null,
  }));
  void dependencies.execute?.("reader.getAttachment", async () => ({ attachment: null }));
  void dependencies.execute?.("reader.listAnnotations", async () => ({ annotations: [] }));

  // @ts-expect-error Reader work results must remain a complete, command-owned DTO.
  void dependencies.execute?.("reader.getWorkPdfCandidates", async () => ({
    pdfAttachments: [],
    work: { id: "work-id" },
  }));
  // @ts-expect-error Reader attachment results must remain a complete, command-owned DTO.
  void dependencies.execute?.("reader.getAttachment", async () => ({
    attachment: { id: "attachment-id" },
  }));
  // @ts-expect-error Reader annotation results must remain a complete, command-owned DTO.
  void dependencies.execute?.("reader.listAnnotations", async () => ({
    annotations: [{ id: "annotation-id" }],
  }));
}

void assertCompileTimeReaderMetadataOutput;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Reader metadata payload boundary", () => {
  it("uses command-owned DTOs and bounded, explicit metadata queries", () => {
    const contract = source("electron/reader-command-contract.ts");
    const commands = source("electron/main/reader-commands.ts");
    const metadataQueries = source("electron/main/reader-metadata-queries.ts");
    const session = source("src/features/reader/library-reader-session.ts");
    const libraryRead = source("src/services/library-read.ts");

    for (const dto of ["ReaderWork", "ReaderAttachment", "ReaderAnnotation"]) {
      expect(contract).toContain(`interface ${dto}`);
    }
    for (const rawRowType of ["WorkWithAuthors", "AttachmentRow", "AnnotationRow"]) {
      expect(contract).not.toContain(rawRowType);
      expect(session).not.toContain(rawRowType);
      expect(libraryRead).not.toContain(rawRowType);
    }

    expect(metadataQueries).toContain("MAX_READER_METADATA_OUTPUT_BYTES");
    expect(metadataQueries).toContain("MAX_READER_PDF_CANDIDATE_ROWS");
    expect(metadataQueries).toContain("MAX_READER_ANNOTATION_ROWS");
    expect(metadataQueries).toContain("MAX_READER_WORK_AUTHOR_ROWS");
    expect(metadataQueries).toContain("MAX_READER_METADATA_TEXT_BYTES");
    expect(metadataQueries).toContain("MAX_READER_ANNOTATION_ANCHOR_BYTES");
    expect(metadataQueries).toContain("MAX_READER_ANNOTATION_CONTENT_BYTES");
    expect(metadataQueries).toContain("requireBoundedReaderRows");
    expect(metadataQueries).toContain("requireBoundedReaderMetadataOutput");
    expect(metadataQueries).toContain("assertReaderAnnotationPayloadWithinBudget");
    expect(metadataQueries).toContain("WITH bounded_annotations AS");
    expect(metadataQueries).toContain('Buffer.byteLength(serialized, "utf8")');
    expect(commands).toContain("loadReaderWork");
    expect(commands).toContain("loadReaderPdfAttachments");
    expect(commands).toContain("loadReaderAnnotations");
    expect(commands).toContain("findActiveReaderAttachmentForWork");
    expect(metadataQueries).not.toMatch(/SELECT\s+(?:[A-Za-z_][\w]*\.)?\*/);
    expect(commands).not.toContain(".forWork(");
    expect(commands).not.toContain(".listForAttachment(");
  });
});
