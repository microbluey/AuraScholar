const FTS_SEARCH_TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function buildWorksFtsQuery(search: string): string | null {
  const tokens = search.match(FTS_SEARCH_TOKEN_RE) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}
