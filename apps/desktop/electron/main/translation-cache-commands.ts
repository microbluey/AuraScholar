import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import type {
  DataCommandOutput,
  DataCommandRequest,
  TranslationCacheClearCommandInput,
  TranslationCacheClearCommandResult,
  TranslationCacheGetCommandInput,
  TranslationCacheGetCommandResult,
  TranslationCachePutCommandInput,
  TranslationCachePutCommandResult,
} from "../data-command-contract";
import { isRecord, type DataCommandDependencies } from "./data-command-runtime";

const MAX_TRANSLATION_CACHE_CACHE_KEY_LENGTH = 512;
const MAX_TRANSLATION_CACHE_ENGINE_LENGTH = 1_024;
const MAX_TRANSLATION_CACHE_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSLATION_CACHE_RESULT_LENGTH = 2 * 1024 * 1024;
const MAX_TRANSLATION_CACHE_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSLATION_CACHE_TARGET_LANGUAGE_LENGTH = 256;

type TranslationCacheReadCommandName = "translationCache.get";
type TranslationCacheMutationCommandName = "translationCache.clear" | "translationCache.put";
type TranslationCacheCommandName =
  | TranslationCacheReadCommandName
  | TranslationCacheMutationCommandName;

export type TranslationCacheCommandRequest = Extract<
  DataCommandRequest,
  { name: TranslationCacheCommandName }
>;

interface TranslationCacheRow {
  result: unknown;
}

/**
 * Main-process boundary for the app-global translation runtime cache. Cache
 * records never carry Library scope, and only main supplies `created_at`.
 */
export async function executeTranslationCacheCommand(
  request: TranslationCacheCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<TranslationCacheCommandName>> {
  switch (request.name) {
    case "translationCache.get": {
      const input = parseTranslationCacheGetInput(request.input);
      return executeTranslationCacheQuery(dependencies, request.name, (database) =>
        getTranslationCache(database, input),
      );
    }
    case "translationCache.put": {
      const input = parseTranslationCachePutInput(request.input);
      return executeTranslationCacheMutation(dependencies, request.name, (database) =>
        putTranslationCache(database, input),
      );
    }
    case "translationCache.clear": {
      parseTranslationCacheClearInput(request.input);
      return executeTranslationCacheMutation(dependencies, request.name, clearTranslationCache);
    }
  }
}

function executeTranslationCacheQuery<K extends TranslationCacheReadCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) {
    throw new Error("Main-process translation cache query execution is unavailable");
  }
  return dependencies.execute(commandName, operation);
}

function executeTranslationCacheMutation<K extends TranslationCacheMutationCommandName>(
  dependencies: DataCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  return dependencies.transaction(commandName, operation);
}

function parseTranslationCacheGetInput(value: unknown): TranslationCacheGetCommandInput {
  const input = requireExactTranslationCacheInput(value, "translationCache.get", ["cacheKey"]);
  return {
    cacheKey: requireTranslationCacheText(
      input.cacheKey,
      "Translation cache key",
      MAX_TRANSLATION_CACHE_CACHE_KEY_LENGTH,
      MAX_TRANSLATION_CACHE_CACHE_KEY_LENGTH * 4,
      true,
    ),
  };
}

function parseTranslationCachePutInput(value: unknown): TranslationCachePutCommandInput {
  const input = requireExactTranslationCacheInput(value, "translationCache.put", [
    "cacheKey",
    "engine",
    "targetLang",
    "result",
  ]);
  const result = requireTranslationCacheText(
    input.result,
    "Translation cache result",
    MAX_TRANSLATION_CACHE_RESULT_LENGTH,
    MAX_TRANSLATION_CACHE_RESULT_BYTES,
    true,
  );
  if (!isTranslationCacheResultWithinOutputBudget(result)) {
    throw new Error(
      `Translation cache output is limited to ${MAX_TRANSLATION_CACHE_OUTPUT_BYTES} bytes`,
    );
  }
  return {
    cacheKey: requireTranslationCacheText(
      input.cacheKey,
      "Translation cache key",
      MAX_TRANSLATION_CACHE_CACHE_KEY_LENGTH,
      MAX_TRANSLATION_CACHE_CACHE_KEY_LENGTH * 4,
      true,
    ),
    engine: requireTranslationCacheText(
      input.engine,
      "Translation cache engine",
      MAX_TRANSLATION_CACHE_ENGINE_LENGTH,
      MAX_TRANSLATION_CACHE_ENGINE_LENGTH * 4,
      true,
    ),
    result,
    targetLang: requireTranslationCacheText(
      input.targetLang,
      "Translation cache target language",
      MAX_TRANSLATION_CACHE_TARGET_LANGUAGE_LENGTH,
      MAX_TRANSLATION_CACHE_TARGET_LANGUAGE_LENGTH * 4,
      true,
    ),
  };
}

function parseTranslationCacheClearInput(value: unknown): TranslationCacheClearCommandInput {
  return requireExactTranslationCacheInput(
    value,
    "translationCache.clear",
    [],
  ) as TranslationCacheClearCommandInput;
}

function requireExactTranslationCacheInput(
  value: unknown,
  commandName: TranslationCacheCommandName,
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

function requireTranslationCacheText(
  value: unknown,
  label: string,
  maximumLength: number,
  maximumBytes: number,
  requireNonEmpty: boolean,
): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  if (value.length > maximumLength || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} is too long`);
  }
  if (requireNonEmpty && !value.trim()) throw new Error(`${label} is required`);
  return value;
}

async function getTranslationCache(
  database: Database,
  input: TranslationCacheGetCommandInput,
): Promise<TranslationCacheGetCommandResult> {
  const rows = await database.query<TranslationCacheRow>(
    `SELECT result FROM translation_cache WHERE cache_key = ? LIMIT 1`,
    [input.cacheKey],
  );
  const result = safeHistoricalTranslationCacheResult(rows[0]?.result);
  return requireBoundedTranslationCacheOutput({ result });
}

async function putTranslationCache(
  database: Database,
  input: TranslationCachePutCommandInput,
): Promise<TranslationCachePutCommandResult> {
  await database.run(
    `INSERT OR REPLACE INTO translation_cache (cache_key, engine, target_lang, result, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [input.cacheKey, input.engine, input.targetLang, input.result, Date.now()],
  );
  return requireBoundedTranslationCacheOutput({ stored: true });
}

async function clearTranslationCache(
  database: Database,
): Promise<TranslationCacheClearCommandResult> {
  const deleted = await database.run(`DELETE FROM translation_cache`);
  return requireBoundedTranslationCacheOutput({ deleted });
}

/** Old corrupted or over-limit cache rows degrade to cache misses, never IPC failures. */
function safeHistoricalTranslationCacheResult(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.trim()) return null;
  if (value.length > MAX_TRANSLATION_CACHE_RESULT_LENGTH) return null;
  if (Buffer.byteLength(value, "utf8") > MAX_TRANSLATION_CACHE_RESULT_BYTES) return null;
  if (!isTranslationCacheResultWithinOutputBudget(value)) return null;
  return value;
}

/** JSON escaping can expand a legal UTF-8 string; budget the actual IPC envelope. */
function isTranslationCacheResultWithinOutputBudget(result: string): boolean {
  return (
    Buffer.byteLength(JSON.stringify({ result }), "utf8") <= MAX_TRANSLATION_CACHE_OUTPUT_BYTES
  );
}

function requireBoundedTranslationCacheOutput<T>(output: T): T {
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TRANSLATION_CACHE_OUTPUT_BYTES) {
    throw new Error(
      `Translation cache output is limited to ${MAX_TRANSLATION_CACHE_OUTPUT_BYTES} bytes`,
    );
  }
  return output;
}
