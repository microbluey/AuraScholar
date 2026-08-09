const FTS_SEARCH_TOKEN_RE = /[\p{L}\p{N}]+/gu;

/**
 * Turns arbitrary user text into a safe FTS5 prefix query. Tokens are quoted
 * individually so punctuation and FTS operators never alter query semantics.
 */
export function buildFtsPrefixQuery(search: string, maxTokens?: number): string | null {
  const tokens = search.match(FTS_SEARCH_TOKEN_RE) ?? [];
  const bounded = maxTokens === undefined ? tokens : tokens.slice(0, maxTokens);
  if (bounded.length === 0) return null;
  return bounded.map((token) => `"${token}"*`).join(" ");
}

export function buildWorksFtsQuery(search: string): string | null {
  return buildFtsPrefixQuery(search);
}
