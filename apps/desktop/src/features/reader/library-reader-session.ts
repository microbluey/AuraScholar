import { PdfDocument, parseAnnotationAnchorJson, type ReaderAnnotation } from "@aurascholar/reader";
import { AnnotationsRepo, type AnnotationRow } from "@aurascholar/db/repos/annotations";
import { AttachmentsRepo, type AttachmentRow } from "@aurascholar/db/repos/attachments";
import { WorksRepo, type WorkWithAuthors } from "@aurascholar/db/repos/works";
import { getDb } from "../../services/aura-db";
import { loadPdfForWork } from "../../services/library-read";

export interface LibraryReaderSession {
  annotations: ReaderAnnotation[];
  attachment: AttachmentRow;
  doc: PdfDocument;
  work: WorkWithAuthors;
}

export interface LoadLibraryReaderSessionOptions {
  attachmentId?: string;
  signal?: AbortSignal;
}

export interface LibraryReaderSessionDataSource {
  createAnnotation: (
    session: Pick<LibraryReaderSession, "attachment" | "work">,
    annotation: Omit<ReaderAnnotation, "id">,
  ) => Promise<string>;
  listAnnotations: (attachmentId: string) => Promise<AnnotationRow[]>;
  listAttachments: (workId: string) => Promise<AttachmentRow[]>;
  loadDocument: (data: Uint8Array) => Promise<PdfDocument>;
  loadPdf: (
    workId: string,
    attachmentId?: string,
  ) => Promise<{ attachmentId: string; data: Uint8Array } | null>;
  loadWork: (workId: string) => Promise<WorkWithAuthors | null>;
}

export class LibraryReaderSessionError extends Error {
  constructor(
    readonly code:
      | "attachment-missing"
      | "attachment-unavailable"
      | "pdf-invalid"
      | "work-archived"
      | "work-missing",
    message: string,
  ) {
    super(message);
    this.name = "LibraryReaderSessionError";
  }
}

const defaultDataSource: LibraryReaderSessionDataSource = {
  async createAnnotation(session, annotation) {
    const db = await getDb();
    return new AnnotationsRepo(db).create({
      attachmentId: session.attachment.id,
      workId: session.work.id,
      type: annotation.type,
      color: annotation.color,
      pageIndex: annotation.pageIndex,
      anchor: annotation.anchor,
      contentMd: annotation.contentMd,
    });
  },
  async listAnnotations(attachmentId) {
    const db = await getDb();
    return new AnnotationsRepo(db).listForAttachment(attachmentId);
  },
  async listAttachments(workId) {
    const db = await getDb();
    return new AttachmentsRepo(db).forWork(workId);
  },
  loadDocument: (data) => PdfDocument.load(data),
  loadPdf: loadPdfForWork,
  async loadWork(workId) {
    const db = await getDb();
    return new WorksRepo(db).get(workId);
  },
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export function isLibraryReaderAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function libraryReaderRowToAnnotation(row: AnnotationRow): ReaderAnnotation {
  const parsedAnchor = parseAnnotationAnchorJson(row.anchor_json, row.page_index);
  return {
    id: row.id,
    type: row.type as ReaderAnnotation["type"],
    color: row.color ?? "#ffd866",
    pageIndex: row.page_index,
    anchor: parsedAnchor.anchor,
    contentMd: row.content_md ?? undefined,
    orphaned: row.orphaned === 1 || parsedAnchor.recovered,
  };
}

export async function loadLibraryReaderSession(
  workId: string,
  options: LoadLibraryReaderSessionOptions = {},
  dataSource: LibraryReaderSessionDataSource = defaultDataSource,
): Promise<LibraryReaderSession> {
  const { attachmentId, signal } = options;
  throwIfAborted(signal);

  const work = await dataSource.loadWork(workId);
  throwIfAborted(signal);
  if (!work) {
    throw new LibraryReaderSessionError("work-missing", "文献库中没有找到这篇文献。");
  }
  if (work.deleted_at !== null) {
    throw new LibraryReaderSessionError(
      "work-archived",
      "这篇文献已在回收站，请先恢复后再打开 PDF。",
    );
  }

  let pdf: Awaited<ReturnType<LibraryReaderSessionDataSource["loadPdf"]>>;
  try {
    pdf = await dataSource.loadPdf(workId, attachmentId);
  } catch {
    throwIfAborted(signal);
    throw new LibraryReaderSessionError(
      "attachment-unavailable",
      "PDF 附件记录存在，但本地文件无法读取。",
    );
  }
  throwIfAborted(signal);
  if (!pdf) {
    throw new LibraryReaderSessionError("attachment-missing", "这篇文献还没有可阅读的 PDF 附件。");
  }

  const attachments = await dataSource.listAttachments(workId);
  throwIfAborted(signal);
  const attachment = attachments.find((candidate) => candidate.id === pdf?.attachmentId);
  if (!attachment) {
    throw new LibraryReaderSessionError(
      "attachment-missing",
      "所选 PDF 附件已被移除，请重新打开文献。",
    );
  }

  let doc: PdfDocument;
  try {
    doc = await dataSource.loadDocument(pdf.data);
  } catch {
    throwIfAborted(signal);
    throw new LibraryReaderSessionError("pdf-invalid", "PDF 文件无法解析，请尝试重新附加文件。");
  }

  try {
    throwIfAborted(signal);
    const rows = await dataSource.listAnnotations(attachment.id);
    throwIfAborted(signal);
    return {
      annotations: rows.map(libraryReaderRowToAnnotation),
      attachment,
      doc,
      work,
    };
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

export async function createLibraryReaderAnnotation(
  session: Pick<LibraryReaderSession, "attachment" | "work">,
  annotation: Omit<ReaderAnnotation, "id">,
  signal?: AbortSignal,
  dataSource: LibraryReaderSessionDataSource = defaultDataSource,
): Promise<ReaderAnnotation> {
  throwIfAborted(signal);
  const id = await dataSource.createAnnotation(session, annotation);
  return { ...annotation, id };
}
