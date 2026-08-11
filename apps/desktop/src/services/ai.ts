// Renderer-safe AI facade. Provider configuration, API keys, and network
// egress are main-owned; this module only manages UI settings DTOs, PDF text
// extraction, typed commands, and user-facing flashcard failure semantics.
import { PdfDocument, extractFullText } from "@aurascholar/reader";
import type {
  AiProviderKind as MainAiProviderKind,
  AiSettingsSnapshot,
} from "../../electron/ai-command-contract";
import {
  generateAiFlashcards,
  getAiFlashcardTarget,
  recordAiFlashcardFailure,
  testAiProvider as testAiProviderCommand,
} from "./ai-data";
import { describeSafeError, toSafeError } from "./sensitive-text";
import { isStorageRecord, readLocalStorageJson, tryRemoveLocalStorageItem } from "../storage";

export type AiProviderKind = MainAiProviderKind;

export interface AiSettings {
  /** Defaults to "openai-compatible" for settings saved before this field existed. */
  kind?: AiProviderKind;
  /** Optional for Anthropic (defaults to api.anthropic.com). */
  baseUrl: string;
  model: string;
  /** Write-only. An omitted/empty value preserves only the same saved target. */
  apiKey?: string;
}

export type AiSettingsDraft = AiSettingsSnapshot;

const LEGACY_SETTINGS_KEY = "ai-settings";

/**
 * Reads main-owned settings, first handing off a former localStorage record.
 * A legacy configuration without its own inline key is intentionally migrated
 * as unconfigured: main never pairs it with an old named secret.
 */
export async function loadAiSettingsDraft(): Promise<AiSettingsDraft | null> {
  const legacy = readLegacyAiSettings();
  if (legacy) {
    const snapshot = await window.aura.data.command("ai.adoptLegacySettings", legacy);
    tryRemoveLocalStorageItem(LEGACY_SETTINGS_KEY);
    return snapshot;
  }
  return window.aura.data.command("ai.getSettings", {});
}

/** A ready status is based on a main-owned target that has a bound key. */
export async function loadAiSettings(): Promise<Omit<AiSettings, "apiKey"> | null> {
  const settings = await loadAiSettingsDraft();
  if (!settings || !settings.hasApiKey) return null;
  return {
    baseUrl: settings.baseUrl,
    kind: settings.kind,
    model: settings.model,
  };
}

/**
 * The renderer may explicitly replace a saved target/key, but never reads a
 * stored key. Main rejects a changed target without a replacement key.
 */
export function saveAiSettings(settings: AiSettings): Promise<AiSettingsDraft> {
  const apiKey = settings.apiKey?.trim();
  return window.aura.data.command("ai.saveSettings", {
    ...(apiKey ? { apiKey } : {}),
    baseUrl: settings.baseUrl,
    kind: settings.kind ?? "openai-compatible",
    model: settings.model,
  });
}

export function testAiProvider(signal?: AbortSignal): Promise<{ text: string }> {
  return testAiProviderCommand(signal);
}

export interface GenerateResult {
  created: number;
}

export interface GenerateFlashcardsOptions {
  /** Manual requests persist failures so the UI can surface them; optional background attempts may stay silent. */
  persistError?: boolean;
  /** Cancels main-owned provider work before its durable commit boundary. */
  signal?: AbortSignal;
}

function notifyFlashcardsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("aurascholar:flashcards-updated"));
  window.dispatchEvent(new Event("aurascholar:library-updated"));
}

/** Generates AI flashcards for a library work from renderer-extracted PDF text. */
export async function generateFlashcardsForWork(
  workId: string,
  _title: string,
  options: GenerateFlashcardsOptions = {},
): Promise<GenerateResult> {
  try {
    return await generateInner(workId, options.signal);
  } catch (error) {
    const safeError = toSafeError(error);
    if (isAbortError(safeError) || options.persistError === false) throw safeError;
    // Keep the established manual/on-demand error job behavior. Main scopes
    // the record to an active work and returns false for a removed target.
    await recordAiFlashcardFailure({ error: describeSafeError(error), workId });
    throw safeError;
  }
}

async function generateInner(workId: string, signal?: AbortSignal): Promise<GenerateResult> {
  if (signal?.aborted) throw abortError();
  const target = await getAiFlashcardTarget(workId);
  if (!target.active) throw new Error("文献不存在或已在回收站，无法生成闪卡");

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
  if (signal?.aborted) throw abortError();
  if (text.trim().length < 200) {
    throw new Error("PDF 文本提取结果过短(可能是扫描版),暂不支持");
  }

  const result = await generateAiFlashcards({ paperText: text, workId }, signal);
  notifyFlashcardsUpdated();
  return result;
}

function readLegacyAiSettings(): {
  baseUrl: string;
  inlineApiKey?: string;
  kind: AiProviderKind;
  model: string;
} | null {
  const parsed = readLocalStorageJson<unknown>(LEGACY_SETTINGS_KEY, null);
  if (!isStorageRecord(parsed)) return null;
  if (typeof parsed.baseUrl !== "string" || typeof parsed.model !== "string") return null;
  const kind: AiProviderKind = parsed.kind === "anthropic" ? "anthropic" : "openai-compatible";
  const baseUrl = parsed.baseUrl.trim();
  const model = parsed.model.trim();
  if (!model || (!baseUrl && kind !== "anthropic")) return null;
  const inlineApiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  return inlineApiKey ? { baseUrl, inlineApiKey, kind, model } : { baseUrl, kind, model };
}

function isAbortError(error: Error): boolean {
  return error.name === "AbortError";
}

function abortError(): Error {
  const error = new Error("AI request cancelled");
  error.name = "AbortError";
  return error;
}
