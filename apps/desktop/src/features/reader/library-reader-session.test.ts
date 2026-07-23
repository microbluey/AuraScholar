import type { PdfDocument, ReaderAnnotation } from "@aurascholar/reader";
import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import { describe, expect, it, vi } from "vitest";
import {
  LibraryReaderSessionError,
  createLibraryReaderAnnotation,
  loadLibraryReaderSession,
  type LibraryReaderSessionDataSource,
} from "./library-reader-session";

function work(overrides: Partial<WorkWithAuthors> = {}): WorkWithAuthors {
  return {
    id: "work-1",
    title: "Evidence Graphs",
    abstract: "Abstract",
    year: 2024,
    publication_date: null,
    venue_name: "Journal",
    venue_type: null,
    type: "article-journal",
    arxiv_id: null,
    openalex_id: null,
    s2_id: null,
    pmid: null,
    fingerprint: null,
    volume: null,
    issue: null,
    pages: null,
    number_of_volumes: null,
    edition: null,
    section: null,
    publisher: null,
    place_published: null,
    series_title: null,
    short_title: null,
    original_title: null,
    issn: null,
    isbn: null,
    url: null,
    accessed_date: null,
    language: null,
    call_number: null,
    accession_number: null,
    label: null,
    database_name: null,
    keywords_json: null,
    notes_md: null,
    reading_status: "reading",
    starred: 0,
    doi: "10.1000/evidence",
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    authorNames: ["Ada Researcher"],
    ...overrides,
  };
}

function attachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: "attachment-1",
    work_id: "work-1",
    kind: "pdf",
    sha256: "abc123",
    byte_size: 123,
    original_filename: "evidence.pdf",
    fetched_via: "local",
    page_count: 8,
    created_at: 2,
    ...overrides,
  };
}

function annotationRow(overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    id: "annotation-1",
    attachment_id: "attachment-1",
    work_id: "work-1",
    type: "highlight",
    color: "#ffd866",
    page_index: 2,
    anchor_json: JSON.stringify({
      version: 1,
      pageIndex: 2,
      quote: { exact: "important evidence", prefix: "", suffix: "" },
    }),
    content_md: "margin note",
    ink_paths_json: null,
    sort_key: 2,
    orphaned: 0,
    created_at: 3,
    updated_at: 3,
    ...overrides,
  };
}

function fakeDocument() {
  return {
    pageCount: 8,
    destroy: vi.fn(),
  } as unknown as PdfDocument;
}

function dataSource(
  overrides: Partial<LibraryReaderSessionDataSource> = {},
): LibraryReaderSessionDataSource {
  const doc = fakeDocument();
  return {
    createAnnotation: vi.fn(async () => "annotation-new"),
    listAnnotations: vi.fn(async () => [annotationRow()]),
    listAttachments: vi.fn(async () => [attachment()]),
    loadDocument: vi.fn(async () => doc),
    loadPdf: vi.fn(async () => ({
      attachmentId: "attachment-1",
      data: new Uint8Array([1, 2, 3]),
    })),
    loadWork: vi.fn(async () => work()),
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("library reader session", () => {
  it("loads the selected PDF, complete metadata, and persisted annotations", async () => {
    const source = dataSource();

    const session = await loadLibraryReaderSession(
      "work-1",
      { attachmentId: "attachment-1" },
      source,
    );

    expect(source.loadPdf).toHaveBeenCalledWith("work-1", "attachment-1");
    expect(session.work.title).toBe("Evidence Graphs");
    expect(session.attachment.original_filename).toBe("evidence.pdf");
    expect(session.annotations).toEqual([
      expect.objectContaining({
        id: "annotation-1",
        pageIndex: 2,
        contentMd: "margin note",
        anchor: expect.objectContaining({
          quote: expect.objectContaining({ exact: "important evidence" }),
        }),
      }),
    ]);
  });

  it("destroys a document that finishes loading after its request is aborted", async () => {
    const rows = deferred<AnnotationRow[]>();
    const doc = fakeDocument();
    const source = dataSource({
      loadDocument: vi.fn(async () => doc),
      listAnnotations: vi.fn(() => rows.promise),
    });
    const controller = new AbortController();

    const pending = loadLibraryReaderSession(
      "work-1",
      { attachmentId: "attachment-1", signal: controller.signal },
      source,
    );
    await vi.waitFor(() => expect(source.listAnnotations).toHaveBeenCalledOnce());
    controller.abort();
    rows.resolve([annotationRow()]);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(doc.destroy).toHaveBeenCalledOnce();
  });

  it("returns a committed annotation even if its request is aborted during the write", async () => {
    const writtenId = deferred<string>();
    const source = dataSource({
      createAnnotation: vi.fn(() => writtenId.promise),
    });
    const controller = new AbortController();
    const draft: Omit<ReaderAnnotation, "id"> = {
      type: "highlight",
      color: "#ffd866",
      pageIndex: 1,
      anchor: {
        version: 1,
        pageIndex: 1,
        quote: { exact: "saved evidence", prefix: "", suffix: "" },
      },
    };

    const pending = createLibraryReaderAnnotation(
      { work: work(), attachment: attachment() },
      draft,
      controller.signal,
      source,
    );
    await vi.waitFor(() => expect(source.createAnnotation).toHaveBeenCalledOnce());
    controller.abort();
    writtenId.resolve("annotation-committed");

    await expect(pending).resolves.toEqual({ ...draft, id: "annotation-committed" });
  });

  it("rejects archived works before reading an attachment", async () => {
    const source = dataSource({
      loadWork: vi.fn(async () => work({ deleted_at: 99 })),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "work-archived",
      }),
    );
    expect(source.loadPdf).not.toHaveBeenCalled();
  });
});
