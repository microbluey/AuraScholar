import type { Database } from "@aurascholar/db";
import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import { WorksRepo, type WorkWithAuthors } from "@aurascholar/db/repos/works";
import { getLibraryDb } from "./aura-db";

export interface CanvasAnnotationIngressSource {
  annotation: AnnotationRow;
  work: WorkWithAuthors;
}

export interface CanvasPageRepository {
  findActiveAnnotation: (annotationId: string, workId: string) => Promise<AnnotationRow | null>;
  findActiveWork: (workId: string) => Promise<WorkWithAuthors | null>;
}

export interface CanvasPageDataSource {
  open: () => Promise<CanvasPageRepository>;
}

export interface CanvasPageScope {
  db: Database;
  libraryId: string;
}

export function createCanvasPageRepository({
  db,
  libraryId,
}: CanvasPageScope): CanvasPageRepository {
  const works = new WorksRepo(db, libraryId);
  return {
    async findActiveAnnotation(annotationId, workId) {
      const rows = await db.query<AnnotationRow>(
        `SELECT an.*
         FROM annotations an
         JOIN works w ON w.id = an.work_id AND w.deleted_at IS NULL
         JOIN attachments at
           ON at.id = an.attachment_id
          AND at.work_id = an.work_id
          AND at.deleted_at IS NULL
         WHERE an.id = ?
           AND an.work_id = ?
           AND w.library_id = ?
           AND an.deleted_at IS NULL
         LIMIT 1`,
        [annotationId, workId, libraryId],
      );
      return rows[0] ?? null;
    },
    async findActiveWork(workId) {
      const work = await works.get(workId);
      return work?.deleted_at === null ? work : null;
    },
  };
}

const defaultDataSource: CanvasPageDataSource = {
  async open() {
    return createCanvasPageRepository(await getLibraryDb());
  },
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function openRepository(
  signal: AbortSignal | undefined,
  dataSource: CanvasPageDataSource,
): Promise<CanvasPageRepository> {
  throwIfAborted(signal);
  const repository = await dataSource.open();
  throwIfAborted(signal);
  return repository;
}

export async function loadCanvasActiveWork(
  workId: string,
  signal?: AbortSignal,
  dataSource: CanvasPageDataSource = defaultDataSource,
): Promise<WorkWithAuthors | null> {
  const repository = await openRepository(signal, dataSource);
  const work = await repository.findActiveWork(workId);
  throwIfAborted(signal);
  return work;
}

export async function loadCanvasAnnotationIngressSource(
  annotationId: string,
  workId: string,
  signal?: AbortSignal,
  dataSource: CanvasPageDataSource = defaultDataSource,
): Promise<CanvasAnnotationIngressSource> {
  const repository = await openRepository(signal, dataSource);
  const annotation = await repository.findActiveAnnotation(annotationId, workId);
  throwIfAborted(signal);
  if (!annotation) throw new Error("没有找到属于这篇文献的批注，可能已被移除");
  if (annotation.work_id !== workId) throw new Error("这条批注不属于请求加入的文献");

  const work = await repository.findActiveWork(annotation.work_id);
  throwIfAborted(signal);
  if (!work) throw new Error("批注的来源文献已不存在或位于回收站");
  return { annotation, work };
}
