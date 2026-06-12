import { uuidv7 } from "uuidv7";

/** Time-ordered UUID for all primary keys — sorts by creation time, sync-friendly. */
export function newId(): string {
  return uuidv7();
}

/**
 * Dedup fingerprint for works without a DOI:
 * normalized title + year + first author family name.
 */
export function workFingerprint(title: string, year?: number | null, firstAuthorFamily?: string | null): string {
  const normTitle = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const normAuthor = (firstAuthorFamily ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z一-鿿]/g, "");
  return `${normTitle}|${year ?? ""}|${normAuthor}`;
}

/** Normalizes a DOI: strips URL prefixes and lowercases (DOIs are case-insensitive). */
export function normalizeDoi(input: string): string | null {
  const m = input
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .match(/^10\.\d{4,9}\/\S+$/);
  return m ? m[0].toLowerCase() : null;
}
