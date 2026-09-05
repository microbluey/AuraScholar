import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { AiSynthesizeDocumentCommandResult } from "../../../electron/ai-command-contract";
import { DocumentSynthesisPanel, DocumentSynthesisResult } from "./DocumentSynthesisPanel";
import { documentSynthesisStatusPresentation } from "./document-synthesis-presentation";

const result: AiSynthesizeDocumentCommandResult = {
  answerMarkdown: "## 结论\n\n当前结果受到样本范围限制。[cite:1]",
  claims: [
    {
      citationIds: ["cite:1"],
      citationRelations: { "cite:1": "qualifies" },
      citations: [
        {
          anchorSnapshot: { kind: "pdf", pageIndex: 4, version: 1 },
          assetId: "asset:one",
          citationId: "cite:1",
          contentUnitId: "unit:one",
          quotedText: "The sample was limited to one study setting.",
          revisionId: "revision:current-one",
          sourceContentHash: "a".repeat(64),
          workId: "work:one",
        },
      ],
      claimKey: "claim:one",
      coverage: "partial-support",
      kind: "factual",
      text: "结果的适用范围受到单一研究场景限制。",
    },
  ],
  modelName: "local-model",
  packHash: "b".repeat(64),
  status: "answer",
};

describe("DocumentSynthesisPanel", () => {
  it("introduces an explicitly session-only, document-scoped request form", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DocumentSynthesisPanel enabled workId="work:one" workTitle="Evidence paper" />
      </MemoryRouter>,
    );

    expect(markup).toContain("只基于当前文献提问");
    expect(markup).toContain("不会写入 Evidence、批注或文献库");
    expect(markup).toContain('id="reader-document-synthesis-query"');
    expect(markup).toContain("基于证据生成");
  });

  it("keeps the answer editable but displays main-issued evidence as revision-bound cards", () => {
    const markup = renderToStaticMarkup(
      <DocumentSynthesisResult
        answerDraft={result.answerMarkdown}
        copyStatus={null}
        onAnswerDraftChange={vi.fn()}
        onCopy={vi.fn()}
        result={result}
        status={documentSynthesisStatusPresentation(result.status)}
        workTitle="Evidence paper"
      />,
    );

    expect(markup).toContain("会话草稿");
    expect(markup).toContain("复制 Markdown");
    expect(markup).toContain("主张与证据");
    expect(markup).toContain("限定");
    expect(markup).toContain("The sample was limited to one study setting.");
    expect(markup).toContain("revision:cur");
    expect(markup).not.toContain("保存为 Evidence");
  });

  it("does not expose a persistence-capable synthesis surface in unavailable runtimes", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <DocumentSynthesisPanel enabled={false} workId="work:one" workTitle="Preview paper" />
      </MemoryRouter>,
    );

    expect(markup).toContain("证据合成仅在桌面应用中可用");
    expect(markup).not.toContain("reader-document-synthesis-query");
  });
});
