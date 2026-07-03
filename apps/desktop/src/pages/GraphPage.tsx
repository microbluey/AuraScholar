// Standalone citation graph page. The reader's 脉络 tab is the primary entry,
// but this route remains important for deep links from the library.
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Input } from "@aurascholar/ui";
import { CitationGraphView } from "../components/CitationGraphView";
import { InlineNotice } from "../components/InlineNotice";
import { isImeComposing } from "../keyboard";

const EXAMPLE_DOIS = [
  {
    label: "Transformer",
    value: "10.48550/arXiv.1706.03762",
  },
  {
    label: "AlphaFold",
    value: "10.1038/s41586-021-03819-2",
  },
  {
    label: "CRISPR",
    value: "10.1126/science.1225829",
  },
] as const;

function isDesktopRuntime(): boolean {
  return "aura" in window;
}

function normalizeDoi(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

function doiIsLikelyValid(value: string): boolean {
  return /^10\.\S+\/\S+$/i.test(value.trim());
}

export function GraphPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = normalizeDoi(params.get("doi") ?? "");
  const [input, setInput] = useState(initial);
  const [doi, setDoi] = useState(initial);
  const [message, setMessage] = useState("");

  const desktopRuntime = isDesktopRuntime();
  const normalizedInput = useMemo(() => normalizeDoi(input), [input]);
  const hasGraph = doi.length > 0;
  const inputReady = doiIsLikelyValid(normalizedInput);

  const submit = useCallback(() => {
    const next = normalizeDoi(input);
    if (!next) {
      setMessage("请输入 DOI 后再生成图谱。");
      return;
    }
    setDoi(next);
    setParams({ doi: next }, { replace: true });
    setMessage(doiIsLikelyValid(next) ? "" : "这个 DOI 看起来不标准，仍会尝试查询。");
  }, [input, setParams]);

  const fillExample = useCallback((value: string) => {
    const next = normalizeDoi(value);
    setInput(next);
    setMessage("");
  }, []);

  return (
    <main className="graph-page graph-page--workbench">
      <section className="graph-hero">
        <div>
          <p className="app-page-kicker">Citation context</p>
          <h1 className="app-page-title">引文脉络</h1>
          <p className="app-page-subtitle">
            用 DOI 拉取 OpenAlex
            一跳上下游引用，按年份展开论文关系，帮助判断一篇文章在领域中的位置。
          </p>
        </div>
        <div className="graph-summary" aria-label="引文图谱状态">
          <span className="graph-summary__item graph-summary__item--ready">
            <strong>{desktopRuntime ? "桌面" : "预览"}</strong>
            <small>运行环境</small>
          </span>
          <span className="graph-summary__item">
            <strong>{hasGraph ? "1-hop" : "待输入"}</strong>
            <small>图谱深度</small>
          </span>
          <span className="graph-summary__item">
            <strong>{inputReady ? "就绪" : "校验"}</strong>
            <small>DOI 状态</small>
          </span>
        </div>
      </section>

      <InlineNotice className="graph-status" message={message} />

      <Card className="graph-command-card">
        <div className="graph-command-card__head">
          <div>
            <h2>生成图谱</h2>
            <p>粘贴 DOI 或 DOI URL。图谱会缓存一周，库中文献节点会自动标绿。</p>
          </div>
          <Badge variant={desktopRuntime ? "success" : "warning"}>
            {desktopRuntime ? "可联网构建" : "浏览器预览"}
          </Badge>
        </div>
        <div className="graph-command">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeComposing(event)) submit();
            }}
            placeholder="10.48550/arXiv.1706.03762"
            aria-label="图谱中心论文 DOI"
          />
          <Button onClick={submit} disabled={!normalizedInput}>
            生成图谱
          </Button>
        </div>
        <div className="graph-examples">
          <strong>示例</strong>
          {EXAMPLE_DOIS.map((example) => (
            <button key={example.value} type="button" onClick={() => fillExample(example.value)}>
              {example.label}
            </button>
          ))}
        </div>
      </Card>

      {hasGraph ? (
        <section className="graph-workspace">
          <Card className="graph-card graph-card--canvas">
            <CitationGraphView doi={doi} height={620} />
          </Card>
          <aside className="graph-side-panel">
            <Card className="graph-card">
              <h2>阅读图谱</h2>
              <div className="graph-guide">
                <span>
                  <strong>灰色</strong>
                  本文引用的基础工作
                </span>
                <span>
                  <strong>橙色</strong>
                  引用本文的后续工作
                </span>
                <span>
                  <strong>绿圈</strong>
                  已经在你的文献库中
                </span>
              </div>
            </Card>
            <Card className="graph-card">
              <h2>下一步</h2>
              <div className="graph-actions">
                <Button variant="secondary" onClick={() => navigate("/library")}>
                  回到文献库
                </Button>
                <Button variant="secondary" onClick={() => navigate("/discovery")}>
                  去发现更多
                </Button>
              </div>
            </Card>
          </aside>
        </section>
      ) : (
        <Card className="graph-empty">
          <Badge variant="neutral">Ready</Badge>
          <h2>用一篇论文打开它的学术邻域</h2>
          <p>输入 DOI 后，AuraScholar 会拉取参考文献和施引文献，按年份组织成可探索的时间线。</p>
          <div className="graph-empty__steps">
            <span>
              <strong>01</strong>
              粘贴 DOI
            </span>
            <span>
              <strong>02</strong>
              查看上下游
            </span>
            <span>
              <strong>03</strong>
              收进文献库
            </span>
          </div>
        </Card>
      )}
    </main>
  );
}
