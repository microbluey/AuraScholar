import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DataCommandDependencies } from "./data-command-runtime";

function assertCompileTimeCanvasIngressOutput(dependencies: DataCommandDependencies): void {
  void dependencies.execute?.("canvas.getActiveWork", async () => ({ work: null }));
  void dependencies.execute?.("canvas.getAnnotationIngressSource", async () => ({ source: null }));

  // @ts-expect-error Canvas active-work results must remain complete command-owned DTOs.
  void dependencies.execute?.("canvas.getActiveWork", async () => ({ work: { id: "work-id" } }));
  // @ts-expect-error Canvas annotation ingress results must remain complete command-owned DTOs.
  void dependencies.execute?.("canvas.getAnnotationIngressSource", async () => ({
    source: { annotation: { id: "annotation-id" }, work: { id: "work-id" } },
  }));
}

void assertCompileTimeCanvasIngressOutput;

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Canvas ingress payload boundary", () => {
  it("uses command-owned DTOs and bounded explicit ingress queries", () => {
    const contract = source("electron/canvas-command-contract.ts");
    const commands = source("electron/main/canvas-page-commands.ts");
    const ingressQueries = source("electron/main/canvas-ingress-queries.ts");
    const ingressLimits = source("src/shared/canvas-ingress-limits.ts");
    const commandResultCodec = source("src/shared/canvas-page-command-result-codec.ts");
    const rendererGateway = source("src/services/canvas-page-data.ts");
    const citationResolver = source("src/features/canvas/canvas-citation-resolver.ts");

    for (const dto of [
      "CanvasActiveWork",
      "CanvasIngressWork",
      "CanvasIngressAnnotation",
      "CanvasAnnotationIngressSource",
    ]) {
      expect(contract).toContain(`interface ${dto}`);
    }
    for (const rawRowType of ["WorkWithAuthors", "AnnotationRow"]) {
      expect(contract).not.toContain(rawRowType);
      expect(rendererGateway).not.toContain(rawRowType);
      expect(commands).not.toContain(rawRowType);
      expect(ingressQueries).not.toContain(rawRowType);
    }
    expect(rendererGateway).toContain('from "../../electron/data-command-contract"');
    for (const sourceText of [
      ingressLimits,
      commandResultCodec,
      rendererGateway,
      citationResolver,
    ]) {
      expect(sourceText).not.toContain("@aurascholar/db");
      expect(sourceText).not.toMatch(/(?:from|import\()\s*["']node:/);
    }
    expect(commandResultCodec).toContain("decodeCanvasGetActiveWorkResult");
    expect(commandResultCodec).toContain("decodeCanvasGetCitationRelationsResult");
    expect(rendererGateway).toContain("decodeCanvasGetActiveWorkResult");
    expect(rendererGateway).toContain("decodeCanvasGetAnnotationIngressSourceResult");
    expect(citationResolver).toContain("decodeCanvasGetCitationRelationsResult");
    expect(citationResolver).toContain("decodeCanvasPersistCitationRelationsResult");

    for (const limit of [
      "MAX_CANVAS_INGRESS_AUTHOR_ROWS",
      "MAX_CANVAS_INGRESS_IDENTIFIER_BYTES",
      "MAX_CANVAS_INGRESS_METADATA_TEXT_BYTES",
      "MAX_CANVAS_INGRESS_ANNOTATION_ANCHOR_BYTES",
      "MAX_CANVAS_INGRESS_ANNOTATION_CONTENT_BYTES",
      "MAX_CANVAS_INGRESS_OUTPUT_BYTES",
    ]) {
      expect(ingressQueries).toContain(limit);
      expect(ingressLimits).toContain(`export const ${limit}`);
    }
    expect(ingressQueries).toContain("MAX_CANVAS_INGRESS_AUTHOR_ROWS + 1");
    expect(ingressQueries).toContain("LIMIT ?");
    expect(ingressQueries).toContain("length(CAST(");
    expect(ingressQueries).toContain("AS BLOB))");
    expect(ingressQueries).toContain("requireBoundedCanvasIngressOutput");
    expect(ingressQueries).toContain('Buffer.byteLength(serialized, "utf8")');
    expect(ingressQueries).not.toMatch(/SELECT\s+(?:[A-Za-z_][\w]*\.)?\*/);
    expect(ingressQueries).not.toContain("new WorksRepo");
    expect(ingressQueries).not.toContain(".get(");

    expect(commands).toContain("loadCanvasIngressWork");
    expect(commands).toContain("loadCanvasAnnotationIngressSource");
    expect(commands).toContain("requireBoundedCanvasIngressOutput");
    expect(commands).not.toContain("new WorksRepo");
    expect(commands).not.toContain(".get(");
    expect(commands).not.toContain("findActiveAnnotation");
  });
});
