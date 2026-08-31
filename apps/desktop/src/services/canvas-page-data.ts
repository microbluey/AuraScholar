import type {
  CanvasActiveWork as CanvasActiveWorkDto,
  CanvasAnnotationIngressSource as CanvasAnnotationIngressSourceDto,
  CanvasIngressAnnotation as CanvasIngressAnnotationDto,
  CanvasIngressWork as CanvasIngressWorkDto,
} from "../../electron/data-command-contract";
import {
  decodeCanvasGetActiveWorkResult,
  decodeCanvasGetAnnotationIngressSourceResult,
} from "../shared/canvas-page-command-result-codec";

export type CanvasActiveWork = CanvasActiveWorkDto;
export type CanvasAnnotationIngressSource = CanvasAnnotationIngressSourceDto;
export type CanvasIngressAnnotation = CanvasIngressAnnotationDto;
export type CanvasIngressWork = CanvasIngressWorkDto;

/**
 * Testable renderer boundary for Canvas ingress reads. The production source
 * resolves the active local Library in the main process; injected sources let
 * callers retain cancellation and defensive-result coverage without SQL.
 */
export interface CanvasPageDataSource {
  getActiveWork: (workId: string) => Promise<CanvasActiveWork | null>;
  getAnnotationIngressSource: (
    annotationId: string,
    workId: string,
  ) => Promise<CanvasAnnotationIngressSource | null>;
}

const defaultDataSource: CanvasPageDataSource = {
  async getActiveWork(workId) {
    return decodeCanvasGetActiveWorkResult(
      await window.aura.data.command("canvas.getActiveWork", { workId }),
      workId,
    ).work;
  },
  async getAnnotationIngressSource(annotationId, workId) {
    return decodeCanvasGetAnnotationIngressSourceResult(
      await window.aura.data.command("canvas.getAnnotationIngressSource", {
        annotationId,
        workId,
      }),
      annotationId,
      workId,
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
): Promise<CanvasActiveWork | null> {
  throwIfAborted(signal);
  const work = await dataSource.getActiveWork(workId);
  throwIfAborted(signal);
  if (work && work.id !== workId.trim()) {
    throw new Error("返回的文献与请求加入的文献不一致");
  }
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
  if (source.annotation.id !== annotationId.trim()) {
    throw new Error("返回的批注与请求加入的批注不一致");
  }
  if (source.annotation.work_id !== workId.trim()) {
    throw new Error("这条批注不属于请求加入的文献");
  }
  if (
    source.work.id !== workId.trim() ||
    source.work.id !== source.annotation.work_id ||
    source.work.deleted_at !== null
  ) {
    throw new Error("批注的来源文献已不存在或位于回收站");
  }
  return source;
}
