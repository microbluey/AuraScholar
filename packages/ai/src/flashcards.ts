// Flashcard generation: structure-aware text trimming + versioned prompt +
// schema-validated output. No RAG — single-document summarization doesn't
// need a vector store.
import { z } from "zod";
import type { AIProvider } from "./provider.js";

export const PROMPT_VERSION = "flashcards-v1";

export const FlashcardOutputSchema = z.object({
  tldr: z.string().describe("One-sentence takeaway"),
  problem: z.string(),
  method: z.string(),
  contributions: z.array(z.string()).min(1).max(5),
  results: z.string(),
  limitations: z.string(),
  qaCards: z
    .array(z.object({ q: z.string(), a: z.string() }))
    .min(2)
    .max(6),
});

export type FlashcardOutput = z.infer<typeof FlashcardOutputSchema>;

/** Character budget ≈ 8k tokens of paper text; leaves room for the prompt. */
const TEXT_BUDGET = 28_000;

/**
 * Trims full paper text to the highest-signal sections. Strategy: keep the
 * head (title/abstract/intro live there) and the tail (conclusion), drop the
 * middle when over budget — works without section parsing across publishers.
 */
export function trimPaperText(fullText: string): string {
  const text = fullText.replace(/\s+/g, " ").trim();
  if (text.length <= TEXT_BUDGET) return text;
  const head = text.slice(0, Math.floor(TEXT_BUDGET * 0.7));
  const tail = text.slice(-Math.floor(TEXT_BUDGET * 0.3));
  return `${head}\n[...]\n${tail}`;
}

export interface FlashcardRequest {
  title: string;
  paperText: string;
  /** Output language for the cards. */
  language?: "zh" | "en";
}

export async function generateFlashcards(
  provider: AIProvider,
  req: FlashcardRequest,
): Promise<FlashcardOutput> {
  const lang = req.language ?? "zh";
  const langLine =
    lang === "zh"
      ? "Write all card content in Chinese (技术术语可保留英文)."
      : "Write all card content in English.";
  return provider.generateObject({
    schema: FlashcardOutputSchema,
    temperature: 0.3,
    maxTokens: 2000,
    messages: [
      {
        role: "system",
        content: `You are an expert research assistant who distills papers into precise study cards for researchers. Be faithful to the paper — never invent results. ${langLine}`,
      },
      {
        role: "user",
        content: `Distill the following paper into structured flashcards.

Paper title: ${req.title}

Required JSON shape:
{
  "tldr": "one sentence capturing the core idea",
  "problem": "what problem the paper tackles and why it matters",
  "method": "the key technical approach",
  "contributions": ["2-5 distinct contributions"],
  "results": "headline quantitative/qualitative results",
  "limitations": "honest limitations or open questions",
  "qaCards": [{"q": "active-recall question", "a": "concise answer"}, ...]
}

Paper text:
${trimPaperText(req.paperText)}`,
      },
    ],
  });
}

/** Converts a generation into front/back card pairs for storage. */
export function flashcardsToCards(
  out: FlashcardOutput,
  title: string,
): Array<{ cardType: string; frontMd: string; backMd: string }> {
  const cards: Array<{ cardType: string; frontMd: string; backMd: string }> = [
    { cardType: "tldr", frontMd: `《${title}》的核心思想是什么?`, backMd: out.tldr },
    { cardType: "method", frontMd: `《${title}》解决什么问题?用什么方法?`, backMd: `**问题**:${out.problem}\n\n**方法**:${out.method}` },
    {
      cardType: "contribution",
      frontMd: `《${title}》的主要贡献有哪些?`,
      backMd: out.contributions.map((c, i) => `${i + 1}. ${c}`).join("\n"),
    },
    { cardType: "limitation", frontMd: `《${title}》的结果与局限?`, backMd: `**结果**:${out.results}\n\n**局限**:${out.limitations}` },
  ];
  for (const qa of out.qaCards) {
    cards.push({ cardType: "qa", frontMd: qa.q, backMd: qa.a });
  }
  return cards;
}
