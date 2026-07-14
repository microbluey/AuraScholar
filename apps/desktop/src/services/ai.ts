// AI service for the desktop app: BYOK config in settings. Non-secret fields
// (kind/baseUrl/model) live in localStorage; the API key is stored encrypted
// via safeStorage (see services/secrets.ts). Flashcard generation pipeline.
import { OpenAICompatibleProvider, AnthropicProvider, generateFlashcards, flashcardsToCards, PROMPT_VERSION, type AIProvider } from "@aurascholar/ai";
import { newId } from "@aurascholar/db/ids";
import { FlashcardsRepo } from "@aurascholar/db/repos/flashcards";
import { PdfDocument, extractFullText } from "@aurascholar/reader";
import { getDb } from "./aura-db";
import { auraHttp } from "./aura-platform";
import { describeSafeError, toSafeError } from "./sensitive-text";
import { SECRET_KEYS, getSecret, migrateInlineSecret, withSecretTransaction } from "./secrets";
import {
  isStorageRecord,
  readLocalStorageJson,
  tryWriteLocalStorageJson,
  writeLocalStorageJson,
} from "../storage";

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

interface StoredAiSettings {
  apiKey: string;
  baseUrl: string;
  kind: AiProviderKind;
  model: string;
  normalizedBaseUrl: string | null;
}

export async function loadAiSettingsDraft(): Promise<AiSettings | null> {
  const stored = await loadStoredAiSettings();
  if (!stored) return null;
  return {
    apiKey: stored.apiKey,
    baseUrl: stored.baseUrl,
    kind: stored.kind,
    model: stored.model,
  };
}

export async function loadAiSettings(): Promise<AiSettings | null> {
  const stored = await loadStoredAiSettings();
  if (!stored) return null;

  // Anthropic can run without a baseUrl; openai-compatible needs one.
  const baseOk =
    stored.normalizedBaseUrl !== null && (stored.kind === "anthropic" || !!stored.normalizedBaseUrl);
  return baseOk && stored.model && stored.apiKey
    ? {
        apiKey: stored.apiKey,
        baseUrl: stored.normalizedBaseUrl ?? "",
        kind: stored.kind,
        model: stored.model,
      }
    : null;
}

async function loadStoredAiSettings(): Promise<StoredAiSettings | null> {
  const parsed = readLocalStorageJson<unknown>(SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;

  const kind: AiProviderKind = parsed.kind === "anthropic" ? "anthropic" : "openai-compatible";
  const rawBaseUrl = typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "";
  const normalizedBaseUrl =
    typeof parsed.baseUrl === "string" ? normalizeStoredAiBaseUrl(kind, parsed.baseUrl) : null;
  const baseUrl = normalizedBaseUrl ?? rawBaseUrl;
  const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
  const inlineApiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";

  // Migrate any inline plaintext key out of localStorage into the secret store.
  const migrated = await migrateInlineSecret(SECRET_KEYS.aiApiKey, inlineApiKey);
  if (inlineApiKey && migrated.persisted) {
    tryWriteLocalStorageJson(SETTINGS_KEY, { baseUrl, kind, model });
  }
  const apiKey = (migrated.value || (await getSecret(SECRET_KEYS.aiApiKey))).trim();
  return { apiKey, baseUrl, kind, model, normalizedBaseUrl };
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const normalized = normalizeAiSettingsForStorage(settings);
  const { apiKey, ...config } = normalized;
  await withSecretTransaction([{ key: SECRET_KEYS.aiApiKey, value: apiKey }], () => {
    writeLocalStorageJson(SETTINGS_KEY, config);
  });
}

function normalizeAiSettingsForStorage(settings: AiSettings): Required<AiSettings> {
  const kind: AiProviderKind = settings.kind === "anthropic" ? "anthropic" : "openai-compatible";
  const baseUrl = normalizeAiBaseUrlForStorage(kind, settings.baseUrl);
  const model = settings.model.trim();
  const apiKey = settings.apiKey.trim();
  if (!model) throw new Error("请填写模型名称。");
  if (!apiKey) throw new Error("请填写 API Key。本地兼容端点也可以填写占位 Key。");
  return { apiKey, baseUrl, kind, model };
}

function normalizeStoredAiBaseUrl(kind: AiProviderKind, value: string): string | null {
  try {
    return normalizeAiBaseUrlForStorage(kind, value);
  } catch {
    return null;
  }
}

function normalizeAiBaseUrlForStorage(kind: AiProviderKind, value: string): string {
  const raw = value.trim();
  if (!raw) {
    if (kind === "anthropic") return "";
    throw new Error("请填写 OpenAI 兼容 API 地址。");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("AI API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AI API 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("AI API 地址不要包含密钥或账号，请填写在 API Key 字段中。");
  }
  if (url.search || url.hash) {
    throw new Error("AI API 地址请填写接口根地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

export async function makeProvider(): Promise<AIProvider | null> {
  const s = await loadAiSettings();
  if (!s) return null;
  if (s.kind === "anthropic") {
    return new AnthropicProvider({
      http: auraHttp,
      baseUrl: s.baseUrl || undefined,
      model: s.model,
      apiKey: s.apiKey,
    });
  }
  return new OpenAICompatibleProvider({
    http: auraHttp,
    baseUrl: s.baseUrl,
    model: s.model,
    apiKey: s.apiKey,
  });
}

export interface GenerateResult {
  created: number;
}

export interface GenerateFlashcardsOptions {
  /** Manual requests persist failures so the UI can surface them; optional background attempts may stay silent. */
  persistError?: boolean;
}

function notifyFlashcardsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("aurascholar:flashcards-updated"));
  window.dispatchEvent(new Event("aurascholar:library-updated"));
}

/** Generates AI flashcards for a library work from its PDF text. */
export async function generateFlashcardsForWork(
  workId: string,
  title: string,
  options: GenerateFlashcardsOptions = {},
): Promise<GenerateResult> {
  try {
    return await generateInner(workId, title);
  } catch (e) {
    const safeError = toSafeError(e);
    const safeMessage = describeSafeError(e);
    if (options.persistError === false) throw safeError;
    // Persist manual/on-demand failures so the reader and library panels can
    // surface them after navigation.
    const db = await getDb();
    const active = await db.query<{ id: string }>(
      `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [workId],
    );
    if (!active[0]) throw safeError;
    await db.run(
      `INSERT INTO ai_jobs (id, kind, work_id, status, error, created_at, updated_at)
       VALUES (?, 'flashcards', ?, 'error', ?, ?, ?)`,
      [newId(), workId, safeMessage, Date.now(), Date.now()],
    );
    throw safeError;
  }
}

async function generateInner(workId: string, title: string): Promise<GenerateResult> {
  const db = await getDb();
  const active = await db.query<{ id: string }>(
    `SELECT id FROM works WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [workId],
  );
  if (!active[0]) throw new Error("文献不存在或已在回收站，无法生成闪卡");

  const provider = await makeProvider();
  if (!provider) throw new Error("请先在设置页配置 AI 服务(地址、模型与 API Key)");

  const { loadPdfForWork } = await import("./library-read");
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
  notifyFlashcardsUpdated();
  return { created: cards.length };
}
