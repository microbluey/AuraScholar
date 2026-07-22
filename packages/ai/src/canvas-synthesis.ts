import { z } from "zod";
import type { AIProvider } from "./provider.js";

export const CANVAS_SYNTHESIS_PROMPT_VERSION = "canvas-synthesis-v1";

export const CanvasSynthesisModeSchema = z.enum([
  "methodology_matrix",
  "contradiction_analysis",
  "research_gap",
  "tldr",
]);

export type CanvasSynthesisMode = z.infer<typeof CanvasSynthesisModeSchema>;

export interface CanvasSynthesisSource {
  id: string;
  kind: "paper" | "excerpt";
  title: string;
  content: string;
}

export interface CanvasSynthesisRequest {
  mode: CanvasSynthesisMode;
  sources: CanvasSynthesisSource[];
  language?: "zh" | "en";
}

const StructuredTableSchema = z
  .object({
    headers: z.array(z.string().min(1)).min(2).max(8),
    rows: z.array(z.array(z.string())).min(1).max(12),
  })
  .superRefine((table, context) => {
    table.rows.forEach((row, index) => {
      if (row.length !== table.headers.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Row ${index + 1} must have ${table.headers.length} cells`,
          path: ["rows", index],
        });
      }
    });
  });

export const CanvasSynthesisOutputSchema = z.object({
  title: z.string().min(1),
  contentMarkdown: z.string().min(1),
  structuredTable: StructuredTableSchema.optional(),
});

export type CanvasSynthesisOutput = z.infer<typeof CanvasSynthesisOutputSchema>;

export const MAX_CANVAS_SYNTHESIS_SOURCES = 10;
const MAX_SOURCE_CHARS = 8_000;

const MODE_INSTRUCTIONS: Record<CanvasSynthesisMode, string> = {
  methodology_matrix:
    "Compare research questions, datasets, methods, assumptions, evidence, strengths, and limitations. Return a compact comparison table in structuredTable.",
  contradiction_analysis:
    "Identify claims that support, qualify, or contradict one another. Distinguish genuine disagreement from differences in scope, dataset, or definition.",
  research_gap:
    "Find defensible research gaps, unresolved assumptions, missing evidence, and concrete follow-up questions. Do not call something a gap merely because it is absent from one source.",
  tldr: "Synthesize the shared thread, distinct contributions, and the most important caveat into a concise literature overview.",
};

function normalizedSources(sources: CanvasSynthesisSource[]): CanvasSynthesisSource[] {
  if (sources.length < 2) throw new Error("AI synthesis requires at least two source nodes");
  if (sources.length > MAX_CANVAS_SYNTHESIS_SOURCES) {
    throw new Error(
      `AI synthesis supports at most ${MAX_CANVAS_SYNTHESIS_SOURCES} source nodes at a time`,
    );
  }
  return sources.map((source) => {
    const id = source.id.trim();
    const title = source.title.trim();
    const content = source.content.replace(/\s+/g, " ").trim().slice(0, MAX_SOURCE_CHARS);
    if (!id || !title || !content) {
      throw new Error("Every AI synthesis source needs an id, title, and content");
    }
    return { ...source, id, title, content };
  });
}

export async function generateCanvasSynthesis(
  provider: AIProvider,
  request: CanvasSynthesisRequest,
): Promise<CanvasSynthesisOutput> {
  const mode = CanvasSynthesisModeSchema.parse(request.mode);
  const sources = normalizedSources(request.sources);
  const languageLine =
    request.language === "en"
      ? "Write the result in English."
      : "Write the result in Chinese; retain established technical terms in English where clearer.";
  const sourceText = sources
    .map(
      (source, index) =>
        `[S${index + 1}] (${source.kind}) ${source.title}\nnode_id: ${source.id}\n${source.content}`,
    )
    .join("\n\n");

  const output = await provider.generateObject({
    schema: CanvasSynthesisOutputSchema,
    temperature: 0.2,
    maxTokens: 2400,
    messages: [
      {
        role: "system",
        content: [
          "You are a careful research synthesis partner.",
          "Use only the supplied sources, preserve uncertainty, and never invent findings, citations, metrics, or causal claims.",
          "When evidence is insufficient, say so explicitly.",
          languageLine,
        ].join(" "),
      },
      {
        role: "user",
        content: `Create a ${mode} synthesis for the selected Spatial Canvas nodes.

Analysis instruction:
${MODE_INSTRUCTIONS[mode]}

Return JSON with:
- title: a precise, short heading
- contentMarkdown: a readable synthesis with inline source markers such as [S1]
- structuredTable: optional except required for methodology_matrix; every row must have the same number of cells as headers

Sources:
${sourceText}`,
      },
    ],
  });
  if (mode === "methodology_matrix" && !output.structuredTable) {
    throw new Error("Methodology matrix synthesis did not return a structured table");
  }
  return output;
}
