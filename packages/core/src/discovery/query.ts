// Shared query-text helpers for discovery search.
//
// Boolean operators (AND/OR/NOT/ANDNOT) are only natively meaningful to arXiv.
// Crossref/OpenAlex/S2 treat their query as free-text relevance matching, so a
// bare "AND"/"OR" would be matched as an ordinary word. We strip them for those
// sources so the remaining keywords still drive a sensible relevance query.

const BOOLEAN_RE = /\b(AND|OR|ANDNOT|NOT)\b/;
const BOOLEAN_RE_G = /\b(AND|OR|ANDNOT|NOT)\b/g;

/** Whether the text contains a boolean operator (uppercase, word-bounded). */
export function hasBoolean(text: string): boolean {
  return BOOLEAN_RE.test(text);
}

/**
 * Remove boolean operators, collapsing to a plain keyword query for sources
 * whose query field is free-text relevance only.
 */
export function stripBoolean(text: string): string {
  return text.replace(BOOLEAN_RE_G, " ").replace(/\s+/g, " ").trim();
}
