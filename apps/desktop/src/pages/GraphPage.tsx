// Standalone graph page — kept for deep links (/graph?doi=...) from the
// library; the primary entry is now the reader's 脉络 tab.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Card, Input } from "@aurascholar/ui";
import { CitationGraphView } from "../components/CitationGraphView";

export function GraphPage() {
  const [params] = useSearchParams();
  const [input, setInput] = useState(params.get("doi") ?? "");
  const [doi, setDoi] = useState(params.get("doi") ?? "");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <h1 className="app-page-title">引文脉络</h1>
      <Card style={{ maxWidth: 720, marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Input
            placeholder="输入 DOI,例如 10.48550/arxiv.1706.03762"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setDoi(input.trim())}
          />
          <Button onClick={() => setDoi(input.trim())}>生成图谱</Button>
        </div>
      </Card>
      {doi && (
        <Card style={{ flex: 1, minHeight: 0, padding: 0, overflow: "hidden" }}>
          <CitationGraphView doi={doi} />
        </Card>
      )}
    </div>
  );
}
