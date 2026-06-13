// AI service for the desktop app: BYOK config in settings (key in localStorage
// for now — OS keychain integration is tracked for before v0.2 release),
// flashcard generation pipeline.
import { OpenAICompatibleProvider, AnthropicProvider, generateFlashcards, flashcardsToCards, PROMPT_VERSION, type AIProvider } from "@aurascholar/ai";
import { FlashcardsRepo, newId } from "@aurascholar/db";
import { PdfDocument, extractFullText } from "@aurascholar/reader";
import { getDb } from "./tauri-db";
import { tauriHttp } from "./tauri-platform";
import { loadPdfForWork } from "./library";

export type AiProviderKind = "openai-compatible" | "anthropic";

export interface AiSettings {
  /** Defaults to "openai-compatible" for settings saved before this field existed. */
  kind?: AiProviderKind;
  /** Optional for Anthropic (defaults to api.anthropic.com). */
  baseUrl: string;
  model: string;
  apiKey: string;
}

const SETTINGS_KEY = "ai-settings";

export function loadAiSettings(): AiSettings | null {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AiSettings;
    const kind = parsed.kind ?? "openai-compatible";
    // Anthropic can run without a baseUrl; openai-compatible needs one.
    const baseOk = kind === "anthropic" || !!parsed.baseUrl;
    return baseOk && parsed.model && parsed.apiKey ? { ...parsed, kind } : null;
  } catch {
    return null;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function makeProvider(): AIProvider | null {
  const s = loadAiSettings();
  if (!s) return null;
  if (s.kind === "anthropic") {
    return new AnthropicProvider({
      http: tauriHttp,
      baseUrl: s.baseUrl || undefined,
      model: s.model,
      apiKey: s.apiKey,
    });
  }
  return new OpenAICompatibleProvider({
    http: tauriHttp,
    baseUrl: s.baseUrl,
    model: s.model,
    apiKey: s.apiKey,
  });
}

export interface GenerateResult {
  created: number;
}

/** Generates AI flashcards for a library work from its PDF text. */
export async function generateFlashcardsForWork(
  workId: string,
  title: string,
): Promise<GenerateResult> {
  try {
    return await generateInner(workId, title);
  } catch (e) {
    // Persist the failure so the reader's 重点 panel can surface it even when
    // the generation was fired in the background at import time.
    const db = await getDb();
    await db.run(
      `INSERT INTO ai_jobs (id, kind, work_id, status, error, created_at, updated_at)
       VALUES (?, 'flashcards', ?, 'error', ?, ?, ?)`,
      [newId(), workId, e instanceof Error ? e.message : String(e), Date.now(), Date.now()],
    );
    throw e;
  }
}

async function generateInner(workId: string, title: string): Promise<GenerateResult> {
  const provider = makeProvider();
  if (!provider) throw new Error("请先在设置页配置 AI 服务(地址、模型与 API Key)");

  const pdf = await loadPdfForWork(workId);
  if (!pdf) throw new Error("这篇文献没有 PDF 附件,无法提取正文");

  const doc = await PdfDocument.load(pdf.data);
  let text: string;
  try {
    text = await extractFullText(doc, 30);
  } finally {
    doc.destroy();
  }
  if (text.trim().length < 200) {
    throw new Error("PDF 文本提取结果过短(可能是扫描版),暂不支持");
  }

  const output = await generateFlashcards(provider, { title, paperText: text, language: "zh" });
  const cards = flashcardsToCards(output, title);

  const db = await getDb();
  const repo = new FlashcardsRepo(db);
  const generationId = newId();
  await repo.createMany(
    cards.map((c) => ({
      workId,
      frontMd: c.frontMd,
      backMd: c.backMd,
      cardType: c.cardType,
      source: "ai",
      aiModel: provider.model,
      generationId,
    })),
  );
  // Record the job for observability/debugging.
  await db.run(
    `INSERT INTO ai_jobs (id, kind, work_id, status, model, prompt_version, result_json, created_at, updated_at)
     VALUES (?, 'flashcards', ?, 'done', ?, ?, ?, ?, ?)`,
    [newId(), workId, provider.model, PROMPT_VERSION, JSON.stringify(output), Date.now(), Date.now()],
  );
  return { created: cards.length };
}
