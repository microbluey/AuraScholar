import { Button } from "@aurascholar/ui";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AiGroundedCitation,
  AiSynthesizeDocumentCommandResult,
} from "../../../electron/ai-command-contract";
import { writeClipboardText } from "../../clipboard";
import { synthesizeAiDocument } from "../../services/ai-data";
import { describeSafeError } from "../../services/sensitive-text";
import {
  DEFAULT_DOCUMENT_SYNTHESIS_QUERY,
  documentSynthesisClaimKindLabel,
  documentSynthesisCoverageLabel,
  documentSynthesisQueryError,
  documentSynthesisRelationLabel,
  documentSynthesisSettingsCta,
  documentSynthesisStatusPresentation,
} from "./document-synthesis-presentation";
import "./document-synthesis.css";

type SynthesisPhase = "error" | "idle" | "running" | "ready";

interface ActiveDocumentSynthesisRun {
  readonly controller: AbortController;
  readonly id: number;
}

export interface DocumentSynthesisPanelProps {
  enabled: boolean;
  workId: string;
  workTitle: string;
}

export function ReaderDocumentSynthesisTab({
  active,
  enabled,
  workId,
  workTitle,
}: DocumentSynthesisPanelProps & { active: boolean }) {
  return (
    <div
      id="reader-panel-synthesis"
      role="tabpanel"
      aria-labelledby="reader-tab-synthesis"
      hidden={!active}
      style={{ height: "100%", display: active ? "block" : "none" }}
    >
      <DocumentSynthesisPanel enabled={enabled} workId={workId} workTitle={workTitle} />
    </div>
  );
}

/**
 * Session-only document synthesis UI. Editable Markdown never becomes
 * canonical Evidence or a durable draft; all cited evidence is main-issued.
 */
export function DocumentSynthesisPanel({
  enabled,
  workId,
  workTitle,
}: DocumentSynthesisPanelProps) {
  const navigate = useNavigate();
  const [answerDraft, setAnswerDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SynthesisPhase>("idle");
  const [query, setQuery] = useState(DEFAULT_DOCUMENT_SYNTHESIS_QUERY);
  const [result, setResult] = useState<AiSynthesizeDocumentCommandResult | null>(null);
  const activeRunRef = useRef<ActiveDocumentSynthesisRun | null>(null);
  const runSequenceRef = useRef(0);

  const cancelActiveRun = useCallback(() => {
    const active = activeRunRef.current;
    if (!active) return;
    activeRunRef.current = null;
    active.controller.abort();
  }, []);

  useEffect(() => {
    return cancelActiveRun;
  }, [cancelActiveRun]);

  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(null), 2_200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const runSynthesis = useCallback(async () => {
    if (!enabled || !workId) return;
    const queryError = documentSynthesisQueryError(query);
    if (queryError) {
      setError(queryError);
      setPhase("error");
      return;
    }

    cancelActiveRun();
    const active: ActiveDocumentSynthesisRun = {
      controller: new AbortController(),
      id: runSequenceRef.current + 1,
    };
    runSequenceRef.current = active.id;
    activeRunRef.current = active;
    setCopyStatus(null);
    setError(null);
    setPhase("running");

    try {
      const output = await synthesizeAiDocument(
        { query: query.trim(), workId },
        active.controller.signal,
      );
      if (active.controller.signal.aborted || activeRunRef.current?.id !== active.id) return;
      // The result can include many claims and source cards; defer its render
      // so changing the question remains responsive on slower machines.
      startTransition(() => {
        setAnswerDraft(output.answerMarkdown);
        setResult(output);
        setPhase("ready");
      });
    } catch (cause) {
      if (active.controller.signal.aborted || activeRunRef.current?.id !== active.id) return;
      setError(describeSafeError(cause));
      setPhase("error");
    } finally {
      if (activeRunRef.current?.id === active.id) activeRunRef.current = null;
    }
  }, [cancelActiveRun, enabled, query, workId]);

  const cancelSynthesis = useCallback(() => {
    if (!activeRunRef.current) return;
    cancelActiveRun();
    setError(null);
    setPhase(result ? "ready" : "idle");
  }, [cancelActiveRun, result]);

  const copyAnswer = useCallback(() => {
    if (!answerDraft.trim()) return;
    void writeClipboardText(answerDraft)
      .then(() => setCopyStatus("已复制 Markdown 草稿"))
      .catch((cause) => setCopyStatus(`复制失败：${describeSafeError(cause)}`));
  }, [answerDraft]);

  if (!enabled) {
    return (
      <section className="reader-document-synthesis" aria-label="证据合成">
        <div className="reader-document-synthesis__empty">
          <strong>证据合成仅在桌面应用中可用</strong>
          <span>请从已入库的 PDF 阅读会话中使用；浏览器预览不会访问本地索引或 AI 设置。</span>
        </div>
      </section>
    );
  }

  const settingsCta = documentSynthesisSettingsCta(error);
  const status = result ? documentSynthesisStatusPresentation(result.status) : null;
  const isRunning = phase === "running";

  return (
    <section
      className="reader-document-synthesis"
      aria-busy={isRunning ? "true" : undefined}
      aria-label="当前文献的证据合成"
    >
      <div className="reader-document-synthesis__intro">
        <span>Grounded synthesis</span>
        <h3>只基于当前文献提问</h3>
        <p>
          回答与证据卡只存在于本次阅读会话；编辑不会写入 Evidence、批注或文献库。
        </p>
      </div>

      <form
        className="reader-document-synthesis__form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSynthesis();
        }}
      >
        <label htmlFor="reader-document-synthesis-query">问题</label>
        <textarea
          id="reader-document-synthesis-query"
          className="au-input reader-document-synthesis__query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：该研究的主要结论受到哪些条件限制？"
          rows={4}
        />
        <div className="reader-document-synthesis__actions">
          <Button type="submit" aria-busy={isRunning ? "true" : undefined} disabled={isRunning}>
            {isRunning ? "正在核验证据…" : result ? "重新生成" : "基于证据生成"}
          </Button>
          {isRunning ? (
            <Button type="button" variant="secondary" onClick={cancelSynthesis}>
              取消
            </Button>
          ) : null}
        </div>
      </form>

      <div className="reader-document-synthesis__feedback" aria-live="polite">
        {isRunning ? <span role="status">正在冻结当前文献范围并核验来源关系…</span> : null}
        {phase === "error" && error ? <span role="alert">{error}</span> : null}
        {settingsCta ? (
          <button type="button" onClick={() => navigate(settingsCta.path)}>
            {settingsCta.label}
          </button>
        ) : null}
      </div>

      {result && status ? (
        <DocumentSynthesisResult
          answerDraft={answerDraft}
          copyStatus={copyStatus}
          onAnswerDraftChange={setAnswerDraft}
          onCopy={copyAnswer}
          result={result}
          status={status}
          workTitle={workTitle}
        />
      ) : null}
    </section>
  );
}

export function DocumentSynthesisResult({
  answerDraft,
  copyStatus,
  onAnswerDraftChange,
  onCopy,
  result,
  status,
  workTitle,
}: {
  answerDraft: string;
  copyStatus: string | null;
  onAnswerDraftChange: (value: string) => void;
  onCopy: () => void;
  result: AiSynthesizeDocumentCommandResult;
  status: ReturnType<typeof documentSynthesisStatusPresentation>;
  workTitle: string;
}) {
  return (
    <div className="reader-document-synthesis__result">
      <header className={`reader-document-synthesis__status reader-document-synthesis__status--${status.tone}`}>
        <div>
          <strong>{status.label}</strong>
          <span>{status.detail}</span>
        </div>
        <small title={result.packHash}>证据包 {result.packHash.slice(0, 12)}…</small>
      </header>

      <div className="reader-document-synthesis__editor-head">
        <label htmlFor="reader-document-synthesis-answer">会话草稿</label>
        <div>
          {copyStatus ? <span role="status">{copyStatus}</span> : null}
          <button type="button" onClick={onCopy} disabled={!answerDraft.trim()}>
            复制 Markdown
          </button>
        </div>
      </div>
      <textarea
        id="reader-document-synthesis-answer"
        className="au-input reader-document-synthesis__answer"
        aria-label={`${workTitle} 的证据合成会话草稿`}
        value={answerDraft}
        onChange={(event) => onAnswerDraftChange(event.target.value)}
        placeholder={
          result.status === "insufficient"
            ? "当前没有足够的最新证据可生成回答。"
            : "回答将在这里显示。"
        }
        rows={10}
      />
      <p className="reader-document-synthesis__draft-note">
        这是一份可编辑的 Markdown 草稿，关闭或切换当前阅读会话后不会保留。
      </p>

      <section className="reader-document-synthesis__claims" aria-label="合成主张与证据">
        <div className="reader-document-synthesis__claims-head">
          <div>
            <h4>主张与证据</h4>
            <p>以下引用由主进程从当前修订中签发，不能由此页面自行替换。</p>
          </div>
          <span>{result.claims.length} 条主张</span>
        </div>
        {result.claims.length > 0 ? (
          <ol>
            {result.claims.map((claim) => (
              <li key={claim.claimKey} className="reader-document-synthesis__claim">
                <header>
                  <span>{documentSynthesisClaimKindLabel(claim.kind)}</span>
                  <strong>{documentSynthesisCoverageLabel(claim.coverage)}</strong>
                </header>
                <p>{claim.text}</p>
                {claim.citations.length > 0 ? (
                  <ul aria-label={`${claim.text} 的证据`}>
                    {claim.citations.map((citation) => (
                      <DocumentSynthesisCitation
                        key={citation.citationId}
                        citation={citation}
                        relation={documentSynthesisRelationLabel(
                          claim.citationRelations[citation.citationId],
                        )}
                      />
                    ))}
                  </ul>
                ) : (
                  <small>此主张没有可用证据引用。</small>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="reader-document-synthesis__claims-empty">
            当前问题没有可展示的经验证主张。可换一个更具体的问题，或先完成文献索引。
          </p>
        )}
      </section>

      <footer className="reader-document-synthesis__meta">
        <span>{result.modelName ? `模型：${result.modelName}` : "未调用模型"}</span>
        <span>范围：当前文献</span>
      </footer>
    </div>
  );
}

function DocumentSynthesisCitation({
  citation,
  relation,
}: {
  citation: AiGroundedCitation;
  relation: string;
}) {
  return (
    <li className="reader-document-synthesis__citation">
      <header>
        <strong>{relation}</strong>
        <code title={citation.citationId}>{citation.citationId}</code>
      </header>
      <blockquote>{citation.quotedText}</blockquote>
      <small title={citation.revisionId}>当前修订 {citation.revisionId.slice(0, 12)}…</small>
    </li>
  );
}
