/**
 * Translation cache commands deliberately remain application-global runtime
 * state. A cache key is content-addressed by the renderer, but the main
 * process owns persistence and its creation timestamp.
 */
export interface TranslationCacheGetCommandInput {
  cacheKey: string;
}

export interface TranslationCacheGetCommandResult {
  result: string | null;
}

export interface TranslationCachePutCommandInput {
  cacheKey: string;
  engine: string;
  result: string;
  targetLang: string;
}

export interface TranslationCachePutCommandResult {
  stored: true;
}

export type TranslationCacheClearCommandInput = Record<string, never>;

export interface TranslationCacheClearCommandResult {
  deleted: number;
}

/** Typed main-process access to the application-global translation cache. */
export interface TranslationCacheDataCommandMap {
  "translationCache.get": {
    input: TranslationCacheGetCommandInput;
    output: TranslationCacheGetCommandResult;
  };
  "translationCache.put": {
    input: TranslationCachePutCommandInput;
    output: TranslationCachePutCommandResult;
  };
  "translationCache.clear": {
    input: TranslationCacheClearCommandInput;
    output: TranslationCacheClearCommandResult;
  };
}
