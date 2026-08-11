import { Buffer } from "node:buffer";
import type {
  AiAdoptLegacySettingsCommandInput,
  AiCancelRunCommandInput,
  AiCanvasSynthesisSource,
  AiCommitFlashcardGenerationCommandInput,
  AiDataCommandName,
  AiFlashcardGeneration,
  AiGenerateFlashcardsCommandInput,
  AiGetFlashcardTargetCommandInput,
  AiRecordFlashcardFailureCommandInput,
  AiSaveSettingsCommandInput,
  AiSynthesizeCanvasCommandInput,
  AiTestProviderCommandInput,
} from "../ai-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";

const MAX_AI_CARD_TEXT_LENGTH = 64 * 1024;
const MAX_AI_GENERATION_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_AI_MODEL_LENGTH = 4 * 1024;
const MAX_AI_PROMPT_VERSION_LENGTH = 4 * 1024;
const MAX_AI_SAFE_ERROR_LENGTH = 16 * 1024;
const MAX_AI_CANVAS_SOURCE_CONTENT_BYTES = 32 * 1024;
const MAX_AI_CANVAS_SOURCE_ID_LENGTH = 512;
const MAX_AI_CANVAS_SOURCE_TITLE_BYTES = 16 * 1024;
const MAX_AI_CANVAS_SOURCE_TOTAL_BYTES = 256 * 1024;
const MAX_AI_CANVAS_SOURCES = 10;
const MAX_AI_FLASHCARD_TEXT_BYTES = 512 * 1024;
const MAX_AI_RUN_REQUEST_ID_LENGTH = 128;
const MAX_CONTRIBUTIONS = 5;
const MAX_QA_CARDS = 6;
const MIN_CONTRIBUTIONS = 1;
const MIN_QA_CARDS = 2;

/**
 * Parses every renderer-controlled AI DTO before it can acquire a main
 * coordinator lease, construct a provider, or reach durable Library state.
 */
export function parseAdoptLegacyAiSettingsInput(value: unknown): AiAdoptLegacySettingsCommandInput {
  const input = requireAiInputWithOptionalFields(
    value,
    "ai.adoptLegacySettings",
    ["baseUrl", "kind", "model"],
    ["inlineApiKey"],
  );
  return {
    baseUrl: requireAiString(input.baseUrl, "AI base URL", MAX_AI_MODEL_LENGTH),
    ...(input.inlineApiKey === undefined
      ? {}
      : {
          inlineApiKey: requireAiString(input.inlineApiKey, "AI API Key", MAX_AI_SAFE_ERROR_LENGTH),
        }),
    kind: requireAiProviderKind(input.kind),
    model: requireAiString(input.model, "AI model", MAX_AI_MODEL_LENGTH),
  };
}

export function parseCancelAiRunInput(value: unknown): AiCancelRunCommandInput {
  const input = requireExactAiInput(value, "ai.cancelRun", ["requestId"]);
  return { requestId: requireAiRunRequestId(input.requestId) };
}

export function parseEmptyAiInput(value: unknown, commandName: AiDataCommandName): void {
  requireExactAiInput(value, commandName, []);
}

export function parseGenerateFlashcardsInput(value: unknown): AiGenerateFlashcardsCommandInput {
  const input = requireExactAiInput(value, "ai.generateFlashcards", [
    "paperText",
    "requestId",
    "workId",
  ]);
  return {
    paperText: requireAiText(
      input.paperText,
      "AI flashcard paper text",
      MAX_AI_FLASHCARD_TEXT_BYTES,
    ),
    requestId: requireAiRunRequestId(input.requestId),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

export function parseSaveAiSettingsInput(value: unknown): AiSaveSettingsCommandInput {
  const input = requireAiInputWithOptionalFields(
    value,
    "ai.saveSettings",
    ["baseUrl", "kind", "model"],
    ["apiKey"],
  );
  return {
    ...(input.apiKey === undefined
      ? {}
      : { apiKey: requireAiString(input.apiKey, "AI API Key", MAX_AI_SAFE_ERROR_LENGTH) }),
    baseUrl: requireAiString(input.baseUrl, "AI base URL", MAX_AI_MODEL_LENGTH),
    kind: requireAiProviderKind(input.kind),
    model: requireAiString(input.model, "AI model", MAX_AI_MODEL_LENGTH),
  };
}

export function parseSynthesizeCanvasInput(value: unknown): AiSynthesizeCanvasCommandInput {
  const input = requireExactAiInput(value, "ai.synthesizeCanvas", ["mode", "requestId", "sources"]);
  if (
    !Array.isArray(input.sources) ||
    input.sources.length < 2 ||
    input.sources.length > MAX_AI_CANVAS_SOURCES
  ) {
    throw new Error(`AI Canvas synthesis supports 2-${MAX_AI_CANVAS_SOURCES} sources`);
  }
  const sources = input.sources.map((source, index) => parseCanvasSynthesisSource(source, index));
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("AI Canvas synthesis source ids must be unique");
  }
  const totalBytes = Buffer.byteLength(
    JSON.stringify(
      sources.map(({ content, id, kind, title, workId }) => ({ content, id, kind, title, workId })),
    ),
    "utf8",
  );
  if (totalBytes > MAX_AI_CANVAS_SOURCE_TOTAL_BYTES) {
    throw new Error(
      `AI Canvas synthesis source payload is limited to ${MAX_AI_CANVAS_SOURCE_TOTAL_BYTES} bytes`,
    );
  }
  return {
    mode: requireCanvasSynthesisMode(input.mode),
    requestId: requireAiRunRequestId(input.requestId),
    sources,
  };
}

export function parseTestAiProviderInput(value: unknown): AiTestProviderCommandInput {
  const input = requireExactAiInput(value, "ai.testProvider", ["requestId"]);
  return { requestId: requireAiRunRequestId(input.requestId) };
}

export function parseGetFlashcardTargetInput(value: unknown): AiGetFlashcardTargetCommandInput {
  const input = requireExactAiInput(value, "ai.getFlashcardTarget", ["workId"]);
  return { workId: requireRecordId(input.workId, "Work id") };
}

export function parseCommitFlashcardGenerationInput(
  value: unknown,
): AiCommitFlashcardGenerationCommandInput {
  const input = requireExactAiInput(value, "ai.commitFlashcardGeneration", [
    "model",
    "promptVersion",
    "result",
    "workId",
  ]);
  const result = parseFlashcardGeneration(input.result);
  assertBoundedSerializedGeneration(result);
  return {
    model: requireAiText(input.model, "AI model", MAX_AI_MODEL_LENGTH),
    promptVersion: requireAiText(
      input.promptVersion,
      "AI prompt version",
      MAX_AI_PROMPT_VERSION_LENGTH,
    ),
    result,
    workId: requireRecordId(input.workId, "Work id"),
  };
}

export function parseRecordFlashcardFailureInput(
  value: unknown,
): AiRecordFlashcardFailureCommandInput {
  const input = requireExactAiInput(value, "ai.recordFlashcardFailure", ["error", "workId"]);
  return {
    error: requireAiText(input.error, "AI failure detail", MAX_AI_SAFE_ERROR_LENGTH),
    workId: requireRecordId(input.workId, "Work id"),
  };
}

function requireExactAiInput(
  value: unknown,
  commandName: AiDataCommandName,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireAiInputWithOptionalFields(
  value: unknown,
  commandName: AiDataCommandName,
  requiredFields: readonly string[],
  optionalFields: readonly string[],
): Record<string, unknown> {
  const permitted = new Set([...requiredFields, ...optionalFields]);
  if (
    !isRecord(value) ||
    Object.keys(value).some((field) => !permitted.has(field)) ||
    requiredFields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`Invalid ${commandName} input`);
  }
  return value;
}

function requireAiProviderKind(value: unknown): "openai-compatible" | "anthropic" {
  if (value === "openai-compatible" || value === "anthropic") return value;
  throw new Error("AI provider kind is invalid");
}

function requireAiString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${label} is too long`);
  return value;
}

function requireAiRunRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_AI_RUN_REQUEST_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new Error("AI request id is invalid");
  }
  return value;
}

function requireCanvasSynthesisMode(value: unknown): AiSynthesizeCanvasCommandInput["mode"] {
  if (
    value === "methodology_matrix" ||
    value === "contradiction_analysis" ||
    value === "research_gap" ||
    value === "tldr"
  ) {
    return value;
  }
  throw new Error("AI Canvas synthesis mode is invalid");
}

function parseCanvasSynthesisSource(value: unknown, index: number): AiCanvasSynthesisSource {
  const source = requireExactAiRecord(value, `AI Canvas source at index ${index}`, [
    "content",
    "id",
    "kind",
    "title",
    "workId",
  ]);
  const id = requireAiText(
    source.id,
    `AI Canvas source id at index ${index}`,
    MAX_AI_CANVAS_SOURCE_ID_LENGTH,
  );
  if (source.kind !== "paper" && source.kind !== "excerpt") {
    throw new Error(`AI Canvas source kind at index ${index} is invalid`);
  }
  return {
    content: requireAiText(
      source.content,
      `AI Canvas source content at index ${index}`,
      MAX_AI_CANVAS_SOURCE_CONTENT_BYTES,
    ),
    id,
    kind: source.kind,
    title: requireAiText(
      source.title,
      `AI Canvas source title at index ${index}`,
      MAX_AI_CANVAS_SOURCE_TITLE_BYTES,
    ),
    workId: requireRecordId(source.workId, `AI Canvas source work id at index ${index}`),
  };
}

function parseFlashcardGeneration(value: unknown): AiFlashcardGeneration {
  const result = requireExactAiRecord(value, "AI flashcard generation", [
    "contributions",
    "limitations",
    "method",
    "problem",
    "qaCards",
    "results",
    "tldr",
  ]);
  if (
    !Array.isArray(result.contributions) ||
    result.contributions.length < MIN_CONTRIBUTIONS ||
    result.contributions.length > MAX_CONTRIBUTIONS
  ) {
    throw new Error("AI flashcard contributions are invalid");
  }
  if (
    !Array.isArray(result.qaCards) ||
    result.qaCards.length < MIN_QA_CARDS ||
    result.qaCards.length > MAX_QA_CARDS
  ) {
    throw new Error("AI flashcard Q&A cards are invalid");
  }
  return {
    contributions: result.contributions.map((contribution, index) =>
      requireAiText(
        contribution,
        `AI flashcard contribution at index ${index}`,
        MAX_AI_CARD_TEXT_LENGTH,
      ),
    ),
    limitations: requireAiText(
      result.limitations,
      "AI flashcard limitations",
      MAX_AI_CARD_TEXT_LENGTH,
    ),
    method: requireAiText(result.method, "AI flashcard method", MAX_AI_CARD_TEXT_LENGTH),
    problem: requireAiText(result.problem, "AI flashcard problem", MAX_AI_CARD_TEXT_LENGTH),
    qaCards: result.qaCards.map((card, index) => parseQaCard(card, index)),
    results: requireAiText(result.results, "AI flashcard results", MAX_AI_CARD_TEXT_LENGTH),
    tldr: requireAiText(result.tldr, "AI flashcard TLDR", MAX_AI_CARD_TEXT_LENGTH),
  };
}

function requireExactAiRecord(
  value: unknown,
  label: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function parseQaCard(value: unknown, index: number): { a: string; q: string } {
  const card = requireExactAiRecord(value, `AI flashcard Q&A card at index ${index}`, ["a", "q"]);
  return {
    a: requireAiText(card.a, `AI flashcard answer at index ${index}`, MAX_AI_CARD_TEXT_LENGTH),
    q: requireAiText(card.q, `AI flashcard question at index ${index}`, MAX_AI_CARD_TEXT_LENGTH),
  };
}

function requireAiText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${label} is too long`);
  return value;
}

function assertBoundedSerializedGeneration(result: AiFlashcardGeneration): void {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AI_GENERATION_RESULT_BYTES) {
    throw new Error(
      `AI flashcard generation is limited to ${MAX_AI_GENERATION_RESULT_BYTES} bytes`,
    );
  }
}
