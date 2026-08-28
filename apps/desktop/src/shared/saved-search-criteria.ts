import type { DiscoveryQuery } from "@aurascholar/core";

export const MAX_SAVED_SEARCH_AUTHOR_BYTES = 2 * 1024;
export const MAX_SAVED_SEARCH_QUERY_BYTES = 8 * 1024;
export const MAX_SAVED_SEARCH_VENUE_BYTES = 2 * 1024;
const MIN_DISCOVERY_YEAR = 1_000;
const MAX_DISCOVERY_YEAR = 3_000;
const CRITERIA_FIELDS = new Set(["text", "author", "yearFrom", "yearTo", "venue"]);

/** Canonicalize the structured conditions persisted by a discovery subscription. */
export function normalizeSavedSearchCriteria(value: unknown): DiscoveryQuery {
  if (!isRecord(value) || !Object.hasOwn(value, "text")) {
    throw new Error("Saved search criteria are invalid");
  }
  if (Object.keys(value).some((field) => !CRITERIA_FIELDS.has(field))) {
    throw new Error("Saved search criteria contain an unsupported field");
  }
  const author = optionalText(value.author, "Saved search author", MAX_SAVED_SEARCH_AUTHOR_BYTES);
  const venue = optionalText(value.venue, "Saved search venue", MAX_SAVED_SEARCH_VENUE_BYTES);
  const yearFrom = optionalYear(value.yearFrom, "Saved search start year");
  const yearTo = optionalYear(value.yearTo, "Saved search end year");
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) {
    throw new Error("Saved search year range is invalid");
  }
  return {
    text: requiredText(value.text, "Saved search query", MAX_SAVED_SEARCH_QUERY_BYTES),
    ...(author ? { author } : {}),
    ...(yearFrom !== undefined ? { yearFrom } : {}),
    ...(yearTo !== undefined ? { yearTo } : {}),
    ...(venue ? { venue } : {}),
  };
}

/** Legacy rows keep their query text, while malformed JSON fails safely closed to it. */
export function parseSavedSearchCriteria(
  criteriaJson: string | null,
  fallbackQuery: string,
): DiscoveryQuery {
  const fallback = { text: normalizeLegacyQuery(fallbackQuery) };
  if (!criteriaJson) return fallback;
  try {
    const criteria = normalizeSavedSearchCriteria(JSON.parse(criteriaJson));
    return comparableText(criteria.text) === comparableText(fallback.text) ? criteria : fallback;
  } catch {
    return fallback;
  }
}

/** Stable comparison identity; text fields are case- and whitespace-insensitive. */
export function savedSearchCriteriaKey(criteria: DiscoveryQuery): string {
  const normalized = normalizeSavedSearchCriteria(criteria);
  return JSON.stringify({
    text: comparableText(normalized.text),
    ...(normalized.author ? { author: comparableText(normalized.author) } : {}),
    ...(normalized.yearFrom !== undefined ? { yearFrom: normalized.yearFrom } : {}),
    ...(normalized.yearTo !== undefined ? { yearTo: normalized.yearTo } : {}),
    ...(normalized.venue ? { venue: comparableText(normalized.venue) } : {}),
  });
}

function optionalText(value: unknown, label: string, maximumBytes: number): string | undefined {
  if (value === undefined) return undefined;
  const text = requiredText(value, label, maximumBytes);
  return text || undefined;
}

function requiredText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const text = normalizeLegacyQuery(value);
  if (!text) throw new Error(`${label} is required`);
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new Error(`${label} is too long`);
  }
  if (hasForbiddenControlCharacter(text)) throw new Error(`${label} is invalid`);
  return text;
}

function optionalYear(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MIN_DISCOVERY_YEAR ||
    (value as number) > MAX_DISCOVERY_YEAR
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value as number;
}

function normalizeLegacyQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function comparableText(value: string): string {
  return normalizeLegacyQuery(value).toLocaleLowerCase();
}

/** Keep saved conditions executable by the bounded scholarly search command. */
function hasForbiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x1f && ![0x09, 0x0a, 0x0d].includes(codePoint)) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
