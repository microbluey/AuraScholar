import { useEffect, useState } from "react";
import type { ReaderAnnotation } from "@aurascholar/reader";
import type { ReaderSessionLease } from "./reader-session-coordinator";
import { loadReaderEvidenceDeepLink } from "./evidence-deep-link";

interface ReaderEvidenceSpotlightState {
  annotation: ReaderAnnotation;
  evidenceId: string;
  generation: ReaderSessionLease["generation"];
  pageIndex: number;
}

export function useReaderEvidenceDeepLink(input: {
  attachmentId?: string;
  evidenceId?: string;
  lease: ReaderSessionLease | null;
  onError: (message: string) => void;
  workId?: string;
}): ReaderEvidenceSpotlightState | null {
  const { attachmentId, evidenceId, lease, onError, workId } = input;
  const [spotlight, setSpotlight] = useState<ReaderEvidenceSpotlightState | null>(null);

  useEffect(() => {
    if (!attachmentId || !evidenceId || !lease || !workId) return;
    let active = true;
    void loadReaderEvidenceDeepLink({
      attachmentId,
      evidenceId,
      signal: lease.signal,
      workId,
    })
      .then((result) => {
        if (!active || !lease.isCurrent()) return;
        setSpotlight(
          result ? { ...result, evidenceId, generation: lease.generation } : null,
        );
        if (!result) onError("没有找到要定位的 Evidence，已保留当前原文位置。");
      })
      .catch((cause: unknown) => {
        if (!active || lease.signal.aborted || !lease.isCurrent()) return;
        const message = cause instanceof Error ? cause.message : "Evidence 定位失败";
        setSpotlight(null);
        onError(message);
      });
    return () => {
      active = false;
    };
  }, [attachmentId, evidenceId, lease, onError, workId]);

  if (!spotlight || spotlight.generation !== lease?.generation) return null;
  return spotlight.evidenceId === evidenceId ? spotlight : null;
}
