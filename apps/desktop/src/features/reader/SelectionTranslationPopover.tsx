import type { ReaderTextSelection } from "@aurascholar/reader";
import { langLabel, type TranslateConfig } from "@aurascholar/translate";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { writeClipboardText } from "../../clipboard";
import { describeSafeError } from "../../services/sensitive-text";
import { loadTranslateConfig, resolveTranslator } from "../../services/translate";

const AI_CONFIGURATION_ERROR_RE = /配置 AI 服务|配置.*AI/;
const TRANSLATION_CONFIGURATION_ERROR_RE = /填写 DeepL|填写百度翻译|配置.*翻译/;

export function translationSettingsCta(
  message: string | null,
): { label: string; path: string } | null {
  if (message && AI_CONFIGURATION_ERROR_RE.test(message)) {
    return { label: "去配置 AI", path: "/settings?section=ai" };
  }
  if (message && TRANSLATION_CONFIGURATION_ERROR_RE.test(message)) {
    return { label: "去配置翻译", path: "/settings?section=translate" };
  }
  return null;
}

export function SelectionTranslationPopover({
  selection,
  onClose,
}: {
  selection: ReaderTextSelection;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>(() =>
    selectionPopoverPosition(selection.clientRect),
  );
  const [result, setResult] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [config, setConfig] = useState<TranslateConfig>({ engine: "llm", targetLang: "zh" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const nextConfig = await loadTranslateConfig();
        if (controller.signal.aborted) return;
        setConfig(nextConfig);
        const resolved = await resolveTranslator();
        if (controller.signal.aborted) return;
        if ("error" in resolved) {
          setError(resolved.error);
          return;
        }
        const translated = await resolved.translator.translate(
          { text: selection.text, targetLang: nextConfig.targetLang },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResult(translated.text);
        setEngine(translated.engine);
      } catch (cause) {
        if (!controller.signal.aborted) setError(describeSafeError(cause));
      }
    })();
    return () => controller.abort();
  }, [selection.text]);

  useEffect(() => {
    const updatePosition = () => setPosition(selectionPopoverPosition(selection.clientRect));
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [selection.clientRect]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), 2200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const settingsCta = translationSettingsCta(error);
  return (
    <div
      ref={popoverRef}
      className="reader-selection-translation"
      style={position}
      role="dialog"
      aria-label="划词翻译"
      aria-busy={!result && !error}
    >
      <div className="reader-selection-translation__head">
        <div>
          <strong>划词翻译</strong>
          <span>{langLabel(config.targetLang)}{engine ? ` · ${engine}` : ""}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭划词翻译" title="关闭">×</button>
      </div>
      <p className="reader-selection-translation__source">{selection.text}</p>
      <div className="reader-selection-translation__result" aria-live="polite">
        {error ? (
          <span className="reader-selection-translation__error">{error}</span>
        ) : result ? result : (
          <span className="reader-selection-translation__loading">翻译中...</span>
        )}
      </div>
      <div className="reader-selection-translation__actions">
        {copyStatus ? <span role="status">{copyStatus}</span> : null}
        {settingsCta ? (
          <button type="button" onClick={() => navigate(settingsCta.path)}>{settingsCta.label}</button>
        ) : null}
        {result ? (
          <button
            type="button"
            onClick={() => void writeClipboardText(result)
              .then(() => setCopyStatus("已复制"))
              .catch((cause) => setCopyStatus(`复制失败:${describeSafeError(cause)}`))}
          >
            复制译文
          </button>
        ) : null}
      </div>
    </div>
  );
}

function selectionPopoverPosition(rect: ReaderTextSelection["clientRect"]): CSSProperties {
  const margin = 12;
  const width = Math.min(360, Math.max(260, window.innerWidth - margin * 2));
  const estimatedHeight = 230;
  const centeredLeft = rect.x + rect.width / 2 - width / 2;
  const left = Math.min(window.innerWidth - width - margin, Math.max(margin, centeredLeft));
  const below = rect.y + rect.height + 10;
  const top = below + estimatedHeight <= window.innerHeight
    ? below
    : Math.max(margin, rect.y - estimatedHeight - 10);
  return { left, top, width };
}
