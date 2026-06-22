// AI service for the desktop app: BYOK config in settings. Non-secret fields
// (kind/baseUrl/model) live in localStorage; the API key is stored encrypted
// via safeStorage (see services/secrets.ts). Flashcard generation pipeline.
import { OpenAICompatibleProvider, AnthropicProvider, generateFlashcards, flashcardsToCards, PROMPT_VERSION, type AIProvider } from "@aurascholar/ai";
import { FlashcardsRepo, newId } from "@aurascholar/db";
import { PdfDocument, extractFullText } from "@aurascholar/reader";
import { getDb } from "./tauri-db";
import { tauriHttp } from "./tauri-platform";
import { loadPdfForWork } from "./library";
import { SECRET_KEYS, getSecret, migrateInlineSecret, setSecret } from "./secrets";

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

export async function loadAiSettings(): Promise<AiSettings | null> {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AiSettings;
    const kind = parsed.kind ?? "openai-compatible";
    // Migrate any inline plaintext key out of localStorage into the secret store.
    const migrated = await migrateInlineSecret(SECRET_KEYS.aiApiKey, parsed.apiKey);
    if (parsed.apiKey) {
      const { apiKey: _drop, ...config } = parsed;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...config, kind }));
    }
    const apiKey = migrated || (await getSecret(SECRET_KEYS.aiApiKey));
    // Anthropic can run without a baseUrl; openai-compatible needs one.
    const baseOk = kind === "anthropic" || !!parsed.baseUrl;
    return baseOk && parsed.model && apiKey ? { ...parsed, kind, apiKey } : null;
  } catch {
    return null;
  }
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const { apiKey, ...config } = settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  await setSecret(SECRET_KEYS.aiApiKey, apiKey);
}

export async function makeProvider(): Promise<AIProvider | null> {
  const s = await loadAiSettings();
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
  const provider = await makeProvider();
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
