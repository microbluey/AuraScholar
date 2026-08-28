import { useEffect, useRef, useState } from "react";
import { STATE_LABEL, type SentinelState } from "@aurascholar/core";
import { downloadBlob } from "../../download";
import { isDesktopRuntime } from "../../services/aura-platform";
import { describeSafeError } from "../../services/sensitive-text";
import {
  loadSentinelEventEvidence,
  type SentinelPageEvent,
} from "../../services/sentinel-page-data";
import { getPreviewSentinelEventEvidence } from "./sentinel-preview";

export function SentinelEvidenceRow({ event }: { event: SentinelPageEvent }) {
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const downloadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      downloadAbortRef.current?.abort();
    };
  }, []);

  const downloadEvidence = async () => {
    if (downloading || event.evidenceStatus !== "available") return;
    const controller = new AbortController();
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = controller;
    setDownloading(true);
    setFeedback(null);
    try {
      const result = isDesktopRuntime()
        ? await loadSentinelEventEvidence(event.id, controller.signal)
        : getPreviewSentinelEventEvidence(event.id);
      if (controller.signal.aborted || !mountedRef.current) return;
      if (result.status === "too_large") {
        setFeedback("证据过大，无法安全下载");
      } else if (result.evidenceJson === null) {
        setFeedback("证据已不可用，请刷新后重试");
      } else {
        downloadBlob(
          new Blob([result.evidenceJson], { type: "application/json" }),
          `证据-${event.to_state}-${new Date(event.detected_at).toISOString().slice(0, 10)}.json`,
        );
      }
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        setFeedback(`下载证据失败: ${describeSafeError(error)}`);
      }
    } finally {
      if (downloadAbortRef.current === controller) downloadAbortRef.current = null;
      if (!controller.signal.aborted && mountedRef.current) setDownloading(false);
    }
  };

  return (
    <div className="sentinel-evidence-row">
      <time>{formatEvidenceDate(event.detected_at)}</time>
      <span>
        {STATE_LABEL[event.from_state as SentinelState] ?? event.from_state} →{" "}
        {STATE_LABEL[event.to_state as SentinelState] ?? event.to_state}
      </span>
      {event.evidenceStatus === "available" && (
        <button type="button" onClick={() => void downloadEvidence()} disabled={downloading}>
          {downloading ? "准备中…" : "下载证据"}
        </button>
      )}
      {event.evidenceStatus === "too_large" && <small>证据过大，无法安全下载</small>}
      {feedback && <small role="status">{feedback}</small>}
    </div>
  );
}

function formatEvidenceDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
