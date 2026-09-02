import { canonicalJson, sha256Text } from "./hash.js";

/** Versioned wire contract for a resolved retrieval corpus scope. */
export const CORPUS_SCOPE_SNAPSHOT_VERSION = 1 as const;

/** Scope kinds that can be selected by the product surfaces. */
export const CORPUS_SCOPE_KINDS = ["library", "project", "works", "asset"] as const;
export type CorpusScopeKind = (typeof CORPUS_SCOPE_KINDS)[number];

/**
 * User selection before the main process resolves it to source identities.
 * `allowedSourceIds` is deliberately not part of this type: a renderer may
 * choose a scope, but only a trusted resolver can establish its source list.
 */
export type CorpusScopeSelection =
  | Readonly<{ kind: "library" }>
  | Readonly<{ kind: "project"; projectId: string }>
  | Readonly<{ kind: "works"; workIds: readonly string[] }>
  | Readonly<{ kind: "asset"; assetId: string }>;

/** Inputs to the main-process-owned snapshot constructor. */
export interface CorpusScopeSnapshotInput {
  readonly libraryId: string;
  readonly scope: CorpusScopeSelection;
  /** Canonical source IDs allowed to FTS; may include context-only sources. */
  readonly allowedSourceIds: readonly string[];
  /** Main-process wall-clock milliseconds captured when the scope was resolved. */
  readonly capturedAt: number;
}

/**
 * Immutable, hashable corpus membership used by one knowledge operation.
 * The hash covers every field except itself, including the contract version.
 */
export interface CorpusScopeSnapshot {
  readonly version: typeof CORPUS_SCOPE_SNAPSHOT_VERSION;
  readonly libraryId: string;
  readonly scope: CorpusScopeSelection;
  /** Canonical source IDs allowed to FTS; may include context-only sources. */
  readonly allowedSourceIds: readonly string[];
  readonly capturedAt: number;
  readonly hash: string;
}

/** Keep IDs aligned with the existing desktop record-id boundary. */
export const MAX_CORPUS_SCOPE_ID_LENGTH = 512;
/** A selected-Works scope is bounded before it crosses a command boundary. */
export const MAX_CORPUS_SCOPE_WORK_IDS = 500;

/**
 * Builds a canonical CorpusScopeSnapshot.
 *
 * SHA-256 is asynchronous because the shared package is also used in browser
 * contexts where WebCrypto is the portable implementation. Callers in the
 * Electron main process should await this function before starting retrieval.
 */
export async function createCorpusScopeSnapshot(
  input: CorpusScopeSnapshotInput,
): Promise<CorpusScopeSnapshot> {
  assertExactInput(input);
  const libraryId = normalizeId(input.libraryId, "Library id");
  const scope = freezeScope(normalizeScope(input.scope));
  const allowedSourceIds = Object.freeze(normalizeAllowedSourceIds(input.allowedSourceIds));
  const capturedAt = requireCapturedAt(input.capturedAt);

  const hash = await sha256Text(
    canonicalJson({
      allowedSourceIds,
      capturedAt,
      libraryId,
      scope,
      version: CORPUS_SCOPE_SNAPSHOT_VERSION,
    }),
  );

  return Object.freeze({
    version: CORPUS_SCOPE_SNAPSHOT_VERSION,
    libraryId,
    scope,
    allowedSourceIds,
    capturedAt,
    hash,
  });
}

function assertExactInput(value: unknown): asserts value is CorpusScopeSnapshotInput {
  if (!isRecord(value)) throw new Error("Corpus scope snapshot input is invalid");
  const expected = ["libraryId", "scope", "allowedSourceIds", "capturedAt"] as const;
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => !expected.includes(key as (typeof expected)[number]))
  ) {
    throw new Error("Corpus scope snapshot input contains unsupported fields");
  }
}

function normalizeScope(value: unknown): CorpusScopeSelection {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Corpus scope selection is invalid");
  }

  switch (value.kind) {
    case "library":
      assertExactKeys(value, ["kind"]);
      return { kind: "library" };
    case "project":
      assertExactKeys(value, ["kind", "projectId"]);
      return { kind: "project", projectId: normalizeId(value.projectId, "Project id") };
    case "asset":
      assertExactKeys(value, ["kind", "assetId"]);
      return { kind: "asset", assetId: normalizeId(value.assetId, "Asset id") };
    case "works":
      assertExactKeys(value, ["kind", "workIds"]);
      return {
        kind: "works",
        workIds: normalizeWorkIds(value.workIds),
      };
    default:
      throw new Error(`Unsupported corpus scope selection: ${value.kind}`);
  }
}

function normalizeWorkIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error("Corpus scope Work ids are invalid");
  if (value.length > MAX_CORPUS_SCOPE_WORK_IDS) {
    throw new Error(`Corpus scope Work ids are limited to ${MAX_CORPUS_SCOPE_WORK_IDS}`);
  }

  const ids = Array.from(value, (candidate, index) =>
    normalizeId(candidate, `Work id at index ${index}`),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error("Corpus scope Work ids must be unique");
  }
  // Work selection is a set, not a presentation order. Canonical ordering
  // keeps equivalent clicks on the same documents at one snapshot identity.
  return Object.freeze(ids.sort(compareText));
}

function normalizeAllowedSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Allowed source ids are invalid");
  const ids = Array.from(value, (candidate, index) =>
    normalizeId(candidate, `Allowed source id at index ${index}`),
  );
  return [...new Set(ids)].sort(compareText);
}

function normalizeId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CORPUS_SCOPE_ID_LENGTH) {
    throw new Error(`${label} is invalid`);
  }
  if (containsControlCharacter(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function requireCapturedAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Corpus scope capturedAt is invalid");
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error("Corpus scope selection contains unsupported fields");
  }
}

function freezeScope(scope: CorpusScopeSelection): CorpusScopeSelection {
  return Object.freeze(scope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
