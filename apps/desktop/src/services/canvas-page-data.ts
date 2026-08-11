import type { AnnotationRow } from "@aurascholar/db/repos/annotations";
import type { WorkWithAuthors } from "@aurascholar/db/repos/works";

export interface CanvasAnnotationIngressSource {
  annotation: AnnotationRow;
  work: WorkWithAuthors;
}

/**
 * Testable renderer boundary for Canvas ingress reads. The production source
 * resolves the active local Library in the main process; injected sources let
 * callers retain cancellation and defensive-result coverage without SQL.
 */
export interface CanvasPageDataSource {
  getActiveWork: (workId: string) => Promise<WorkWithAuthors | null>;
  getAnnotationIngressSource: (
    annotationId: string,
    workId: string,
  ) => Promise<CanvasAnnotationIngressSource | null>;
}

const defaultDataSource: CanvasPageDataSource = {
  async getActiveWork(workId) {
    return (await window.aura.data.command("canvas.getActiveWork", { workId })).work;
  },
  async getAnnotationIngressSource(annotationId, workId) {
    return (
      await window.aura.data.command("canvas.getAnnotationIngressSource", {
        annotationId,
        workId,
      })
    ).source;
  },
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export async function loadCanvasActiveWork(
  workId: string,
  signal?: AbortSignal,
  dataSource: CanvasPageDataSource = defaultDataSource,
): Promise<WorkWithAuthors | null> {
  throwIfAborted(signal);
  const work = await dataSource.getActiveWork(workId);
  throwIfAborted(signal);
  return work;
}

export async function loadCanvasAnnotationIngressSource(
  annotationId: string,
  workId: string,
  signal?: AbortSignal,
  dataSource: CanvasPageDataSource = defaultDataSource,
): Promise<CanvasAnnotationIngressSource> {
  throwIfAborted(signal);
  const source = await dataSource.getAnnotationIngressSource(annotationId, workId);
  throwIfAborted(signal);
  if (!source) throw new Error("没有找到属于这篇文献的批注，可能已被移除");
  if (source.annotation.work_id !== workId) {
    throw new Error("这条批注不属于请求加入的文献");
  }
  if (source.work.id !== source.annotation.work_id || source.work.deleted_at !== null) {
    throw new Error("批注的来源文献已不存在或位于回收站");
  }
  return source;
}
