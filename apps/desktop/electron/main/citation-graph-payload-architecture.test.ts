import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Citation Graph command payload boundary", () => {
  it("keeps shared limits renderer-safe and decodes every default IPC result", () => {
    const limits = source("src/shared/citation-graph-limits.ts");
    const codec = source("src/shared/citation-graph-command-result-codec.ts");
    const cacheGateway = source("src/services/citation-graph.ts");
    const pageGateway = source("src/services/citation-graph-page-data.ts");
    const scholarlyGateway = source("src/services/scholarly-data.ts");
    const mainCommands = source("electron/main/citation-graph-commands.ts");
    const scholarlyOutput = source("electron/main/scholarly-command-output.ts");

    for (const rendererSafeSource of [limits, codec]) {
      expect(rendererSafeSource).not.toContain("@aurascholar/db");
      expect(rendererSafeSource).not.toMatch(/(?:from|import\()\s*["']node:/u);
      expect(rendererSafeSource).not.toContain("window.");
    }
    expect(cacheGateway).toContain("decodeCitationGraphGetCachedResult");
    expect(cacheGateway).toContain("decodeCitationGraphPutCachedResult");
    expect(pageGateway).toContain("decodeCitationGraphGetActiveLibraryDoisResult");
    expect(scholarlyGateway).toContain("decodeCitationGraphBuildResult");

    for (const decoder of [
      "decodeCitationGraphBuildResult",
      "decodeCitationGraphGetCachedResult",
      "decodeCitationGraphPutCachedResult",
      "decodeCitationGraphGetActiveLibraryDoisResult",
    ]) {
      expect(codec).toContain(`function ${decoder}`);
    }
    for (const limit of [
      "MAX_CITATION_GRAPH_ACTIVE_LIBRARY_DOIS",
      "MAX_CITATION_GRAPH_CACHE_PAYLOAD_BYTES",
      "MAX_CITATION_GRAPH_DOI_BYTES",
      "MAX_CITATION_GRAPH_EDGES",
      "MAX_CITATION_GRAPH_LIBRARY_ID_BYTES",
      "MAX_CITATION_GRAPH_NODE_ID_BYTES",
      "MAX_CITATION_GRAPH_NODE_TEXT_BYTES",
      "MAX_CITATION_GRAPH_NODES",
    ]) {
      expect(limits).toContain(`export const ${limit}`);
      expect(codec).toContain(limit);
      expect(mainCommands).toContain(limit);
    }
    expect(codec).toContain("isDenseArray");
    expect(mainCommands).toContain("isDenseCitationGraphArray");
    expect(mainCommands).toContain("JSON.stringify([edge.source, edge.target])");
    expect(scholarlyOutput).toContain("MAX_CITATION_GRAPH_DOI_BYTES");
    expect(scholarlyOutput).toContain("MAX_CITATION_GRAPH_EDGES");
    expect(scholarlyOutput).toContain("MAX_CITATION_GRAPH_NODE_ID_BYTES");
    expect(scholarlyOutput).toContain("MAX_CITATION_GRAPH_NODE_TEXT_BYTES");
    expect(scholarlyOutput).toContain("MAX_CITATION_GRAPH_NODES");
  });
});
