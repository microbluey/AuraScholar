const CANVAS_NOTE_DRAFT_VERSION = 1 as const;
const CANVAS_NOTE_DRAFT_KEY_PREFIX = "aurascholar:canvas-note-draft:v1:";

const MAX_ID_LENGTH = 512;
const MAX_TITLE_LENGTH = 20_000;
const MAX_MARKDOWN_LENGTH = 1_500_000;
const MAX_SERIALIZED_RECORD_LENGTH = 2_000_000;

export interface CanvasNoteDraftValue {
  title?: string;
  contentMarkdown: string;
}

export interface CanvasNoteDraftRecord {
  version: typeof CANVAS_NOTE_DRAFT_VERSION;
  workspaceId: string;
  nodeId: string;
  baseFingerprint: string;
  value: CanvasNoteDraftValue;
  savedAt: number;
}

export interface CanvasNoteDraftToken {
  ownerId: string | null;
  raw: string;
  revision: number;
  storageKey: string;
  writeId: string;
}

export interface CanvasNoteDraftCandidate {
  draft: CanvasNoteDraftRecord;
  token: CanvasNoteDraftToken;
}

export type CanvasNoteDraftReadResult =
  | { status: "none" }
  | { status: "recoverable"; draft: CanvasNoteDraftRecord }
  | { status: "conflict"; draft: CanvasNoteDraftRecord }
  | { status: "stale-cleared" }
  | { status: "invalid-discarded" }
  | { status: "unavailable" };

export type CanvasNoteDraftWriteResult =
  | { status: "saved"; draft: CanvasNoteDraftRecord }
  | { status: "cleared" }
  | { status: "unavailable" };

export type CanvasNoteDraftClearResult = { status: "cleared" } | { status: "unavailable" };

export type CanvasNoteWorkspaceDraftClearResult =
  | { status: "cleared"; removed: number }
  | { status: "unavailable"; removed: number };

export type CanvasNoteOwnedDraftReadResult =
  | { status: "none" }
  | {
      status: "recoverable" | "conflict";
      draft: CanvasNoteDraftRecord;
      token: CanvasNoteDraftToken;
      alternates: CanvasNoteDraftCandidate[];
    }
  | { status: "stale-cleared" }
  | { status: "invalid-discarded" }
  | { status: "unavailable" };

export type CanvasNoteOwnedDraftWriteResult =
  | {
      status: "saved";
      draft: CanvasNoteDraftRecord;
      token: CanvasNoteDraftToken;
    }
  | { status: "cleared" }
  | { status: "superseded" }
  | { status: "unavailable" };

export type CanvasNoteOwnedDraftResolveResult =
  | { status: "cleared" }
  | { status: "superseded" }
  | { status: "unavailable" };

export interface ReadCanvasNoteDraftInput {
  workspaceId: string;
  nodeId: string;
  baseValue: CanvasNoteDraftValue;
}

export interface WriteCanvasNoteDraftInput extends ReadCanvasNoteDraftInput {
  value: CanvasNoteDraftValue;
  savedAt?: number;
}

export interface WriteCanvasNoteDraftOwnedInput extends WriteCanvasNoteDraftInput {
  ownerId: string;
  previousToken?: CanvasNoteDraftToken | null;
  writeId?: string;
}

let realmOwnerId: string | null = null;
let fallbackIdSequence = 0;

/**
 * An already edited inline card is a separate draft and must not silently
 * consume a recoverable storage revision that the user has not seen.
 */
export function canvasNoteDraftSourceToken(
  result: CanvasNoteOwnedDraftReadResult,
  initialEditorDirty: boolean,
): CanvasNoteDraftToken | null {
  if (result.status === "conflict") return result.token;
  if (result.status === "recoverable" && !initialEditorDirty) return result.token;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim().length > 0
  );
}

function isValidValue(value: unknown): value is CanvasNoteDraftValue {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(["title", "contentMarkdown"])) ||
    typeof value.contentMarkdown !== "string" ||
    value.contentMarkdown.length > MAX_MARKDOWN_LENGTH
  ) {
    return false;
  }
  return (
    value.title === undefined ||
    (typeof value.title === "string" && value.title.length <= MAX_TITLE_LENGTH)
  );
}

function canonicalNoteValue(value: CanvasNoteDraftValue): string {
  return JSON.stringify([value.title === undefined ? null : value.title, value.contentMarkdown]);
}

function hashString(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Fingerprints the persisted note content itself. It deliberately does not use
 * `node.updatedAt`, because unrelated spatial edits may update that timestamp.
 */
export function canvasNoteFingerprint(value: CanvasNoteDraftValue): string {
  const canonical = canonicalNoteValue(value);
  const first = hashString(canonical, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = hashString(canonical, 0x9e3779b9).toString(16).padStart(8, "0");
  return `v1:${canonical.length}:${first}${second}`;
}

function isValidFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^v1:\d{1,10}:[0-9a-f]{16}$/.test(value);
}

function encodeId(value: string): string | null {
  if (!isValidId(value)) return null;
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

function createOpaqueId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall back to a realm-local identifier when Web Crypto is unavailable.
  }
  fallbackIdSequence += 1;
  return `${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function getCanvasNoteDraftOwnerId(): string {
  if (realmOwnerId === null) realmOwnerId = createOpaqueId();
  return realmOwnerId;
}

export function canvasNoteDraftStorageKey(workspaceId: string, nodeId: string): string | null {
  const encodedWorkspaceId = encodeId(workspaceId);
  const encodedNodeId = encodeId(nodeId);
  if (encodedWorkspaceId === null || encodedNodeId === null) return null;
  return `${CANVAS_NOTE_DRAFT_KEY_PREFIX}${encodedWorkspaceId}:${encodedNodeId}`;
}

function ownedStoragePrefix(workspaceId: string, nodeId: string): string | null {
  const legacyKey = canvasNoteDraftStorageKey(workspaceId, nodeId);
  return legacyKey === null ? null : `${legacyKey}:owner:`;
}

function ownedStorageKey(
  workspaceId: string,
  nodeId: string,
  ownerId: string,
  revision: number,
  writeId: string,
): string | null {
  const prefix = ownedStoragePrefix(workspaceId, nodeId);
  const encodedOwnerId = encodeId(ownerId);
  const encodedWriteId = encodeId(writeId);
  if (
    prefix === null ||
    encodedOwnerId === null ||
    encodedWriteId === null ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    return null;
  }
  return `${prefix}${encodedOwnerId}:rev:${revision}:write:${encodedWriteId}`;
}

function parseOwnedStorageKey(
  workspaceId: string,
  nodeId: string,
  storageKey: string,
): Pick<CanvasNoteDraftToken, "ownerId" | "revision" | "writeId"> | null {
  const prefix = ownedStoragePrefix(workspaceId, nodeId);
  if (prefix === null || !storageKey.startsWith(prefix)) return null;
  const parts = storageKey.slice(prefix.length).split(":");
  if (
    parts.length !== 5 ||
    parts[1] !== "rev" ||
    parts[3] !== "write" ||
    !/^[1-9]\d*$/.test(parts[2] ?? "")
  ) {
    return null;
  }
  try {
    const ownerId = decodeURIComponent(parts[0] ?? "");
    const writeId = decodeURIComponent(parts[4] ?? "");
    const revision = Number(parts[2]);
    if (!isValidId(ownerId) || !isValidId(writeId) || !Number.isSafeInteger(revision)) {
      return null;
    }
    return { ownerId, revision, writeId };
  } catch {
    return null;
  }
}

function workspaceStoragePrefix(workspaceId: string): string | null {
  const encodedWorkspaceId = encodeId(workspaceId);
  return encodedWorkspaceId === null
    ? null
    : `${CANVAS_NOTE_DRAFT_KEY_PREFIX}${encodedWorkspaceId}:`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function removeStorageKey(storage: Storage, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const RECORD_KEYS = new Set([
  "version",
  "workspaceId",
  "nodeId",
  "baseFingerprint",
  "value",
  "savedAt",
]);

function narrowDraftRecord(
  value: unknown,
  workspaceId: string,
  nodeId: string,
): CanvasNoteDraftRecord | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, RECORD_KEYS) ||
    value.version !== CANVAS_NOTE_DRAFT_VERSION ||
    value.workspaceId !== workspaceId ||
    value.nodeId !== nodeId ||
    !isValidId(value.workspaceId) ||
    !isValidId(value.nodeId) ||
    !isValidFingerprint(value.baseFingerprint) ||
    !isValidValue(value.value) ||
    typeof value.savedAt !== "number" ||
    !Number.isSafeInteger(value.savedAt) ||
    value.savedAt < 0
  ) {
    return null;
  }
  return {
    version: CANVAS_NOTE_DRAFT_VERSION,
    workspaceId: value.workspaceId,
    nodeId: value.nodeId,
    baseFingerprint: value.baseFingerprint,
    value: {
      ...(value.value.title === undefined ? {} : { title: value.value.title }),
      contentMarkdown: value.value.contentMarkdown,
    },
    savedAt: value.savedAt,
  };
}

export function readCanvasNoteDraft(input: ReadCanvasNoteDraftInput): CanvasNoteDraftReadResult {
  if (!isValidValue(input.baseValue)) return { status: "unavailable" };
  const key = canvasNoteDraftStorageKey(input.workspaceId, input.nodeId);
  const storage = getStorage();
  if (key === null || storage === null) return { status: "unavailable" };

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "none" };

  if (raw.length > MAX_SERIALIZED_RECORD_LENGTH) {
    return removeStorageKey(storage, key)
      ? { status: "invalid-discarded" }
      : { status: "unavailable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return removeStorageKey(storage, key)
      ? { status: "invalid-discarded" }
      : { status: "unavailable" };
  }

  const draft = narrowDraftRecord(parsed, input.workspaceId, input.nodeId);
  if (draft === null) {
    return removeStorageKey(storage, key)
      ? { status: "invalid-discarded" }
      : { status: "unavailable" };
  }

  const currentFingerprint = canvasNoteFingerprint(input.baseValue);
  const draftFingerprint = canvasNoteFingerprint(draft.value);
  if (draftFingerprint === currentFingerprint) {
    return removeStorageKey(storage, key) ? { status: "stale-cleared" } : { status: "unavailable" };
  }
  if (draft.baseFingerprint !== currentFingerprint) {
    return { status: "conflict", draft };
  }
  return { status: "recoverable", draft };
}

export function writeCanvasNoteDraft(input: WriteCanvasNoteDraftInput): CanvasNoteDraftWriteResult {
  if (!isValidValue(input.baseValue) || !isValidValue(input.value)) {
    return { status: "unavailable" };
  }
  const key = canvasNoteDraftStorageKey(input.workspaceId, input.nodeId);
  const storage = getStorage();
  if (key === null || storage === null) return { status: "unavailable" };

  const baseFingerprint = canvasNoteFingerprint(input.baseValue);
  if (canvasNoteFingerprint(input.value) === baseFingerprint) {
    return removeStorageKey(storage, key) ? { status: "cleared" } : { status: "unavailable" };
  }

  const savedAt = input.savedAt ?? Date.now();
  if (!Number.isSafeInteger(savedAt) || savedAt < 0) return { status: "unavailable" };
  const draft: CanvasNoteDraftRecord = {
    version: CANVAS_NOTE_DRAFT_VERSION,
    workspaceId: input.workspaceId,
    nodeId: input.nodeId,
    baseFingerprint,
    value: {
      ...(input.value.title === undefined ? {} : { title: input.value.title }),
      contentMarkdown: input.value.contentMarkdown,
    },
    savedAt,
  };
  const serialized = JSON.stringify(draft);
  if (serialized.length > MAX_SERIALIZED_RECORD_LENGTH) return { status: "unavailable" };

  try {
    storage.setItem(key, serialized);
    return { status: "saved", draft };
  } catch {
    // Never remove the previous recoverable draft when its replacement fails.
    return { status: "unavailable" };
  }
}

export function clearCanvasNoteDraft(
  workspaceId: string,
  nodeId: string,
): CanvasNoteDraftClearResult {
  const key = canvasNoteDraftStorageKey(workspaceId, nodeId);
  const storage = getStorage();
  if (key === null || storage === null) return { status: "unavailable" };
  return removeStorageKey(storage, key) ? { status: "cleared" } : { status: "unavailable" };
}

export function clearCanvasNoteDraftsForWorkspace(
  workspaceId: string,
): CanvasNoteWorkspaceDraftClearResult {
  const prefix = workspaceStoragePrefix(workspaceId);
  const storage = getStorage();
  if (prefix === null || storage === null) return { status: "unavailable", removed: 0 };

  const keys: string[] = [];
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return { status: "unavailable", removed: 0 };
  }

  let removed = 0;
  for (const key of keys) {
    if (!removeStorageKey(storage, key)) {
      return { status: "unavailable", removed };
    }
    removed += 1;
  }
  return { status: "cleared", removed };
}

function opaqueFingerprint(value: string): string {
  const first = hashString(value, 0x6d2b79f5).toString(16).padStart(8, "0");
  const second = hashString(value, 0x1b873593).toString(16).padStart(8, "0");
  return `${value.length.toString(36)}-${first}${second}`;
}

function tokenResolutionKey(
  workspaceId: string,
  nodeId: string,
  token: CanvasNoteDraftToken,
): string | null {
  const legacyKey = canvasNoteDraftStorageKey(workspaceId, nodeId);
  if (legacyKey === null) return null;
  return `${legacyKey}:resolved:${opaqueFingerprint(`${token.storageKey}\0${token.raw}`)}`;
}

function tokenBelongsToNote(
  workspaceId: string,
  nodeId: string,
  token: CanvasNoteDraftToken,
): boolean {
  const legacyKey = canvasNoteDraftStorageKey(workspaceId, nodeId);
  if (legacyKey === null) return false;
  if (token.ownerId === null) {
    return token.storageKey === legacyKey && token.revision === 0 && token.writeId === "legacy";
  }
  const parsed = parseOwnedStorageKey(workspaceId, nodeId, token.storageKey);
  return (
    parsed !== null &&
    parsed.ownerId === token.ownerId &&
    parsed.revision === token.revision &&
    parsed.writeId === token.writeId
  );
}

function tokenIsResolved(
  storage: Storage,
  workspaceId: string,
  nodeId: string,
  token: CanvasNoteDraftToken,
): boolean | null {
  const key = tokenResolutionKey(workspaceId, nodeId, token);
  if (key === null) return null;
  try {
    return storage.getItem(key) === "1";
  } catch {
    return null;
  }
}

function markTokenResolved(
  storage: Storage,
  workspaceId: string,
  nodeId: string,
  token: CanvasNoteDraftToken,
): boolean {
  const key = tokenResolutionKey(workspaceId, nodeId, token);
  if (key === null) return false;
  try {
    storage.setItem(key, "1");
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function removeImmutableToken(storage: Storage, token: CanvasNoteDraftToken): boolean | null {
  try {
    const current = storage.getItem(token.storageKey);
    if (current === null) return true;
    if (current !== token.raw) return null;
    storage.removeItem(token.storageKey);
    return storage.getItem(token.storageKey) === null;
  } catch {
    return false;
  }
}

function compareDraftCandidates(
  left: CanvasNoteDraftCandidate,
  right: CanvasNoteDraftCandidate,
): number {
  return (
    right.draft.savedAt - left.draft.savedAt ||
    right.token.revision - left.token.revision ||
    right.token.writeId.localeCompare(left.token.writeId) ||
    right.token.storageKey.localeCompare(left.token.storageKey)
  );
}

export function readCanvasNoteDraftOwned(
  input: ReadCanvasNoteDraftInput,
): CanvasNoteOwnedDraftReadResult {
  if (!isValidValue(input.baseValue)) return { status: "unavailable" };
  const legacyKey = canvasNoteDraftStorageKey(input.workspaceId, input.nodeId);
  const ownedPrefix = ownedStoragePrefix(input.workspaceId, input.nodeId);
  const storage = getStorage();
  if (legacyKey === null || ownedPrefix === null || storage === null) {
    return { status: "unavailable" };
  }

  const storageKeys = [legacyKey];
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(ownedPrefix)) storageKeys.push(key);
    }
  } catch {
    return { status: "unavailable" };
  }

  const currentFingerprint = canvasNoteFingerprint(input.baseValue);
  const candidates: CanvasNoteDraftCandidate[] = [];
  let discardedInvalid = false;
  let clearedStale = false;

  for (const storageKey of new Set(storageKeys)) {
    let raw: string | null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      return { status: "unavailable" };
    }
    if (raw === null) continue;

    const parsedKey =
      storageKey === legacyKey
        ? { ownerId: null, revision: 0, writeId: "legacy" }
        : parseOwnedStorageKey(input.workspaceId, input.nodeId, storageKey);
    const token: CanvasNoteDraftToken | null =
      parsedKey === null ? null : { ...parsedKey, storageKey, raw };
    if (token === null || raw.length > MAX_SERIALIZED_RECORD_LENGTH) {
      discardedInvalid = true;
      const removed =
        token?.ownerId === null
          ? markTokenResolved(storage, input.workspaceId, input.nodeId, token)
          : removeStorageKey(storage, storageKey);
      if (!removed) return { status: "unavailable" };
      continue;
    }

    const resolved = tokenIsResolved(storage, input.workspaceId, input.nodeId, token);
    if (resolved === null) return { status: "unavailable" };
    if (resolved) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = null;
    }
    const draft = narrowDraftRecord(parsed, input.workspaceId, input.nodeId);
    if (draft === null) {
      discardedInvalid = true;
      const removed =
        token.ownerId === null
          ? markTokenResolved(storage, input.workspaceId, input.nodeId, token)
          : removeImmutableToken(storage, token);
      if (removed !== true) return { status: "unavailable" };
      continue;
    }

    if (canvasNoteFingerprint(draft.value) === currentFingerprint) {
      clearedStale = true;
      const removed =
        token.ownerId === null
          ? markTokenResolved(storage, input.workspaceId, input.nodeId, token)
          : removeImmutableToken(storage, token);
      if (removed !== true) return { status: "unavailable" };
      continue;
    }
    candidates.push({ draft, token });
  }

  const recoverable = candidates
    .filter((candidate) => candidate.draft.baseFingerprint === currentFingerprint)
    .sort(compareDraftCandidates);
  const conflicts = candidates
    .filter((candidate) => candidate.draft.baseFingerprint !== currentFingerprint)
    .sort(compareDraftCandidates);
  const selected = recoverable[0] ?? conflicts[0];
  if (selected) {
    return {
      status: recoverable.length > 0 ? "recoverable" : "conflict",
      draft: selected.draft,
      token: selected.token,
      alternates: candidates
        .filter((candidate) => candidate.token.storageKey !== selected.token.storageKey)
        .sort(compareDraftCandidates),
    };
  }
  if (discardedInvalid) return { status: "invalid-discarded" };
  if (clearedStale) return { status: "stale-cleared" };
  return { status: "none" };
}

function nextOwnedRevision(
  storage: Storage,
  workspaceId: string,
  nodeId: string,
  ownerId: string,
  previousToken?: CanvasNoteDraftToken | null,
): number | null {
  let highest =
    previousToken?.ownerId === ownerId && Number.isSafeInteger(previousToken.revision)
      ? previousToken.revision
      : 0;
  const prefix = ownedStoragePrefix(workspaceId, nodeId);
  if (prefix === null) return null;
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const parsed = parseOwnedStorageKey(workspaceId, nodeId, key);
      if (parsed?.ownerId === ownerId) highest = Math.max(highest, parsed.revision);
    }
  } catch {
    return null;
  }
  return highest < Number.MAX_SAFE_INTEGER ? highest + 1 : null;
}

export function writeCanvasNoteDraftOwned(
  input: WriteCanvasNoteDraftOwnedInput,
): CanvasNoteOwnedDraftWriteResult {
  if (!isValidValue(input.baseValue) || !isValidValue(input.value) || !isValidId(input.ownerId)) {
    return { status: "unavailable" };
  }
  const storage = getStorage();
  if (storage === null) return { status: "unavailable" };
  if (canvasNoteFingerprint(input.value) === canvasNoteFingerprint(input.baseValue)) {
    if (!input.previousToken) return { status: "cleared" };
    return resolveCanvasNoteDraftOwned(
      input.workspaceId,
      input.nodeId,
      input.ownerId,
      input.previousToken,
    );
  }

  const savedAt = input.savedAt ?? Date.now();
  const writeId = input.writeId ?? createOpaqueId();
  const revision = nextOwnedRevision(
    storage,
    input.workspaceId,
    input.nodeId,
    input.ownerId,
    input.previousToken,
  );
  if (revision === null || !isValidId(writeId) || !Number.isSafeInteger(savedAt) || savedAt < 0) {
    return { status: "unavailable" };
  }
  const storageKey = ownedStorageKey(
    input.workspaceId,
    input.nodeId,
    input.ownerId,
    revision,
    writeId,
  );
  if (storageKey === null) return { status: "unavailable" };

  const draft: CanvasNoteDraftRecord = {
    version: CANVAS_NOTE_DRAFT_VERSION,
    workspaceId: input.workspaceId,
    nodeId: input.nodeId,
    baseFingerprint: canvasNoteFingerprint(input.baseValue),
    value: {
      ...(input.value.title === undefined ? {} : { title: input.value.title }),
      contentMarkdown: input.value.contentMarkdown,
    },
    savedAt,
  };
  const raw = JSON.stringify(draft);
  if (raw.length > MAX_SERIALIZED_RECORD_LENGTH) return { status: "unavailable" };
  try {
    if (storage.getItem(storageKey) !== null) return { status: "superseded" };
    storage.setItem(storageKey, raw);
    if (storage.getItem(storageKey) !== raw) return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }

  const token: CanvasNoteDraftToken = {
    storageKey,
    ownerId: input.ownerId,
    revision,
    writeId,
    raw,
  };
  if (
    input.previousToken?.ownerId === input.ownerId &&
    input.previousToken.storageKey !== storageKey
  ) {
    removeImmutableToken(storage, input.previousToken);
  }
  return { status: "saved", draft, token };
}

export function resolveCanvasNoteDraftOwned(
  workspaceId: string,
  nodeId: string,
  ownerId: string,
  token: CanvasNoteDraftToken,
): CanvasNoteOwnedDraftResolveResult {
  if (!isValidId(ownerId) || !tokenBelongsToNote(workspaceId, nodeId, token)) {
    return { status: "unavailable" };
  }
  const storage = getStorage();
  if (storage === null) return { status: "unavailable" };
  try {
    const current = storage.getItem(token.storageKey);
    if (current === null) return { status: "cleared" };
    if (current !== token.raw) return { status: "superseded" };
  } catch {
    return { status: "unavailable" };
  }

  if (token.ownerId !== null) {
    const removed = removeImmutableToken(storage, token);
    return removed === true
      ? { status: "cleared" }
      : removed === null
        ? { status: "superseded" }
        : { status: "unavailable" };
  }
  return markTokenResolved(storage, workspaceId, nodeId, token)
    ? { status: "cleared" }
    : { status: "unavailable" };
}
