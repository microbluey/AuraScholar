import type { PdfDocument, ReaderAnnotation } from "@aurascholar/reader";
import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type { AttachmentRow } from "@aurascholar/db/repos/attachments";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
import { describe, expect, it, vi } from "vitest";
import {
  LibraryReaderSessionError,
  createLibraryReaderAnnotation,
  deleteLibraryReaderAnnotation,
  loadLibraryReaderSession,
  markLibraryReaderWorkStarted,
  restoreLibraryReaderAnnotation,
  type LibraryReaderSessionDataSource,
  updateLibraryReaderAnnotationContent,
} from "./library-reader-session";
import { ReaderPdfBusyError, ReaderPdfTooLargeError } from "../../services/library-read";

function work(overrides: Partial<WorkWithAuthors> = {}): WorkWithAuthors {
  return {
    id: "work-1",
    library_id: "library:test-reader-session",
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
    deleteAnnotation: vi.fn(async () => undefined),
    getAttachment: vi.fn(async () => attachment()),
    listAnnotations: vi.fn(async () => [annotationRow()]),
    loadDocument: vi.fn(async () => doc),
    loadPdf: vi.fn(async () => ({
      attachmentId: "attachment-1",
      data: new Uint8Array([1, 2, 3]),
    })),
    loadWork: vi.fn(async () => work()),
    markReadingStarted: vi.fn(async () => true),
    restoreAnnotation: vi.fn(async () => undefined),
    updateAnnotationContent: vi.fn(async () => undefined),
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
    expect(source.getAttachment).toHaveBeenCalledWith("work-1", "attachment-1");
    expect(source.listAnnotations).toHaveBeenCalledWith("work-1", "attachment-1");
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

  it("uses the scoped Reader command facade for the default annotation writer", async () => {
    const command = vi.fn(async () => ({ annotationId: "annotation-command" }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    const draft: Omit<ReaderAnnotation, "id"> = {
      type: "note",
      color: "#ffd866",
      pageIndex: 1,
      anchor: {
        version: 1,
        pageIndex: 1,
        quote: { exact: "saved evidence", prefix: "", suffix: "" },
      },
      contentMd: "saved note",
    };

    await expect(
      createLibraryReaderAnnotation({ work: work(), attachment: attachment() }, draft),
    ).resolves.toEqual({
      ...draft,
      id: "annotation-command",
    });
    expect(command).toHaveBeenCalledWith("reader.createAnnotation", {
      anchor: draft.anchor,
      attachmentId: "attachment-1",
      color: "#ffd866",
      contentMd: "saved note",
      pageIndex: 1,
      type: "note",
      workId: "work-1",
    });
  });

  it("does not start any write after its request has already been aborted", async () => {
    const source = dataSource();
    const controller = new AbortController();
    controller.abort();
    const session = { work: work(), attachment: attachment() };
    const draft: Omit<ReaderAnnotation, "id"> = {
      type: "highlight",
      color: "#ffd866",
      pageIndex: 1,
      anchor: {
        version: 1,
        pageIndex: 1,
        quote: { exact: "unsaved evidence", prefix: "", suffix: "" },
      },
    };

    await expect(
      createLibraryReaderAnnotation(session, draft, controller.signal, source),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      deleteLibraryReaderAnnotation("annotation-1", controller.signal, source),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      restoreLibraryReaderAnnotation("annotation-1", controller.signal, source),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      updateLibraryReaderAnnotationContent(
        "annotation-1",
        "unsaved comment",
        controller.signal,
        source,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      markLibraryReaderWorkStarted("work-1", controller.signal, source),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(source.createAnnotation).not.toHaveBeenCalled();
    expect(source.deleteAnnotation).not.toHaveBeenCalled();
    expect(source.restoreAnnotation).not.toHaveBeenCalled();
    expect(source.updateAnnotationContent).not.toHaveBeenCalled();
    expect(source.markReadingStarted).not.toHaveBeenCalled();
  });

  it("reports a committed annotation delete even if aborted during the write", async () => {
    const written = deferred<void>();
    const source = dataSource({
      deleteAnnotation: vi.fn(() => written.promise),
    });
    const controller = new AbortController();

    const pending = deleteLibraryReaderAnnotation("annotation-1", controller.signal, source);
    await vi.waitFor(() => expect(source.deleteAnnotation).toHaveBeenCalledOnce());
    controller.abort();
    written.resolve(undefined);

    await expect(pending).resolves.toBeUndefined();
  });

  it("reports a committed annotation restore even if aborted during the write", async () => {
    const written = deferred<void>();
    const source = dataSource({
      restoreAnnotation: vi.fn(() => written.promise),
    });
    const controller = new AbortController();

    const pending = restoreLibraryReaderAnnotation("annotation-1", controller.signal, source);
    await vi.waitFor(() => expect(source.restoreAnnotation).toHaveBeenCalledOnce());
    controller.abort();
    written.resolve(undefined);

    await expect(pending).resolves.toBeUndefined();
  });

  it("reports a committed annotation content update even if aborted during the write", async () => {
    const written = deferred<void>();
    const source = dataSource({
      updateAnnotationContent: vi.fn(() => written.promise),
    });
    const controller = new AbortController();

    const pending = updateLibraryReaderAnnotationContent(
      "annotation-1",
      "committed comment",
      controller.signal,
      source,
    );
    await vi.waitFor(() => expect(source.updateAnnotationContent).toHaveBeenCalledOnce());
    controller.abort();
    written.resolve(undefined);

    await expect(pending).resolves.toBeUndefined();
    expect(source.updateAnnotationContent).toHaveBeenCalledWith(
      "annotation-1",
      "committed comment",
    );
  });

  it("returns the committed conditional reading-state result after an abort", async () => {
    const written = deferred<boolean>();
    const source = dataSource({
      markReadingStarted: vi.fn(() => written.promise),
    });
    const controller = new AbortController();

    const pending = markLibraryReaderWorkStarted("work-1", controller.signal, source);
    await vi.waitFor(() => expect(source.markReadingStarted).toHaveBeenCalledOnce());
    controller.abort();
    written.resolve(false);

    await expect(pending).resolves.toBe(false);
  });

  it("rejects archived works before reading an attachment", async () => {
    const archived = work({ deleted_at: 99 });
    const source = dataSource({
      loadWork: vi.fn(async () => archived),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "work-archived",
        work: archived,
      }),
    );
    expect(source.loadPdf).not.toHaveBeenCalled();
  });

  it("preserves loaded work context when its PDF is unavailable", async () => {
    const loadedWork = work();
    const source = dataSource({
      loadPdf: vi.fn(async () => null),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "attachment-missing",
        work: loadedWork,
      }),
    );
  });

  it("preserves loaded work context when the PDF blob cannot be read", async () => {
    const loadedWork = work();
    const source = dataSource({
      loadPdf: vi.fn(async () => {
        throw new Error("blob unavailable");
      }),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "attachment-unavailable",
        work: loadedWork,
      }),
    );
  });

  it("keeps an oversized PDF file but exposes a specific Reader session failure", async () => {
    const loadedWork = work();
    const source = dataSource({
      loadPdf: vi.fn(async () => {
        throw new ReaderPdfTooLargeError();
      }),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "attachment-too-large",
        message: "此 PDF 超过当前阅读器单次打开上限（512 MiB），文件已保留。请选择较小的 PDF。",
        work: loadedWork,
      }),
    );
    expect(source.loadDocument).not.toHaveBeenCalled();
  });

  it("keeps a transient Reader PDF admission failure retryable", async () => {
    const loadedWork = work();
    const source = dataSource({
      loadPdf: vi.fn(async () => {
        throw new ReaderPdfBusyError();
      }),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "attachment-opening",
        message: "另一份 PDF 正在打开，请稍后重试。",
        work: loadedWork,
      }),
    );
    expect(source.loadDocument).not.toHaveBeenCalled();
  });

  it("revalidates the chosen PDF attachment under its work before parsing", async () => {
    const loadedWork = work();
    const source = dataSource({
      getAttachment: vi.fn(async () => null),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "attachment-missing",
        work: loadedWork,
      }),
    );
    expect(source.getAttachment).toHaveBeenCalledWith("work-1", "attachment-1");
    expect(source.loadDocument).not.toHaveBeenCalled();
  });

  it("preserves loaded work context when attachment revalidation fails", async () => {
    const loadedWork = work();
    const source = dataSource({
      getAttachment: vi.fn(async () => {
        throw new Error("attachment scope unavailable");
      }),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "attachment-unavailable",
        work: loadedWork,
      }),
    );
  });

  it("preserves loaded work context when the PDF cannot be parsed", async () => {
    const loadedWork = work();
    const source = dataSource({
      loadDocument: vi.fn(async () => {
        throw new Error("invalid PDF");
      }),
      loadWork: vi.fn(async () => loadedWork),
    });

    await expect(loadLibraryReaderSession("work-1", {}, source)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryReaderSessionError>>({
        code: "pdf-invalid",
        work: loadedWork,
      }),
    );
  });
});
