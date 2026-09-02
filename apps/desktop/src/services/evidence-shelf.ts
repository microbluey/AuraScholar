import type {
  ClearEvidenceShelfCommandInput,
  EvidenceShelfItem,
  EvidenceShelfPreviewPayload,
  ListEvidenceShelfCommandInput,
  RemoveEvidenceShelfCommandInput,
  ResolveEvidenceShelfForSaveCommandInput,
  StageEvidenceShelfCommandInput,
} from "../../electron/evidence-shelf-command-contract";
import type { KnowledgeContentSearchResult } from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";
import { isDesktopRuntime } from "./aura-platform";

export type {
  EvidenceShelfItem,
  EvidenceShelfPreviewPayload,
  EvidenceShelfStatus,
} from "../../electron/evidence-shelf-command-contract";

export interface EvidenceShelfServiceOptions {
  signal?: AbortSignal;
}

export interface EvidenceShelfService {
  readonly mode: "desktop" | "preview";
  clear(projectId: string, options?: EvidenceShelfServiceOptions): Promise<number>;
  list(projectId: string, options?: EvidenceShelfServiceOptions): Promise<EvidenceShelfItem[]>;
  remove(
    projectId: string,
    itemId: string,
    expectedUpdatedAt: number,
    options?: EvidenceShelfServiceOptions,
  ): Promise<boolean>;
  resolveForSave(
    projectId: string,
    item: Pick<EvidenceShelfItem, "id" | "revisionId" | "sourceContentHash">,
    options?: EvidenceShelfServiceOptions,
  ): Promise<{ item: EvidenceShelfItem | null; stale: boolean }>;
  stage(
    projectId: string,
    result: KnowledgeContentSearchResult,
    options?: EvidenceShelfServiceOptions,
  ): Promise<{ created: boolean; item: EvidenceShelfItem }>;
}

/**
 * Projects persist only through typed Evidence Shelf commands in the desktop
 * shell. The adapter intentionally captures a search result's preview, while
 * the main process re-reads the canonical ContentUnit and hash before write.
 */
export function createDesktopEvidenceShelfService(): EvidenceShelfService {
  return {
    mode: "desktop",
    async clear(projectId, options) {
      const signal = options?.signal;
      throwIfAborted(signal);
      const libraryId = await getActiveLibraryCommandScope();
      throwIfAborted(signal);
      const input: ClearEvidenceShelfCommandInput = { libraryId, projectId };
      const result = await window.aura.data.command("evidenceShelf.clear", input);
      throwIfAborted(signal);
      return result.removed;
    },
    async list(projectId, options) {
      const signal = options?.signal;
      throwIfAborted(signal);
      const libraryId = await getActiveLibraryCommandScope();
      throwIfAborted(signal);
      const input: ListEvidenceShelfCommandInput = { libraryId, projectId };
      const result = await window.aura.data.command("evidenceShelf.list", input);
      throwIfAborted(signal);
      return result.items;
    },
    async remove(projectId, itemId, expectedUpdatedAt, options) {
      const signal = options?.signal;
      throwIfAborted(signal);
      const libraryId = await getActiveLibraryCommandScope();
      throwIfAborted(signal);
      const input: RemoveEvidenceShelfCommandInput = {
        expectedUpdatedAt,
        itemId,
        libraryId,
        projectId,
      };
      const result = await window.aura.data.command("evidenceShelf.remove", input);
      throwIfAborted(signal);
      return result.removed;
    },
    async resolveForSave(projectId, item, options) {
      const signal = options?.signal;
      throwIfAborted(signal);
      const libraryId = await getActiveLibraryCommandScope();
      throwIfAborted(signal);
      const input: ResolveEvidenceShelfForSaveCommandInput = {
        expectedRevisionId: item.revisionId,
        expectedSourceContentHash: item.sourceContentHash,
        itemId: item.id,
        libraryId,
        projectId,
      };
      const result = await window.aura.data.command("evidenceShelf.resolveForSave", input);
      throwIfAborted(signal);
      return result;
    },
    async stage(projectId, result, options) {
      const signal = options?.signal;
      throwIfAborted(signal);
      const libraryId = await getActiveLibraryCommandScope();
      throwIfAborted(signal);
      const input: StageEvidenceShelfCommandInput = {
        anchorSnapshot: result.anchor,
        contentUnitId: result.id,
        libraryId,
        previewPayload: toPreviewPayload(result),
        projectId,
      };
      const staged = await window.aura.data.command("evidenceShelf.stage", input);
      throwIfAborted(signal);
      return staged;
    },
  };
}

/** Browser preview deliberately never pretends to persist a Shelf. */
export const previewEvidenceShelfService: EvidenceShelfService = {
  mode: "preview",
  async clear(_projectId, options) {
    throwPreviewWrite(options?.signal);
  },
  async list(_projectId, options) {
    options?.signal?.throwIfAborted();
    return [];
  },
  async remove(_projectId, _itemId, _expectedUpdatedAt, options) {
    throwPreviewWrite(options?.signal);
  },
  async resolveForSave(_projectId, _item, options) {
    options?.signal?.throwIfAborted();
    return { item: null, stale: true };
  },
  async stage(_projectId, _result, options) {
    throwPreviewWrite(options?.signal);
  },
};

export const evidenceShelfService: EvidenceShelfService =
  typeof window !== "undefined" && isDesktopRuntime()
    ? createDesktopEvidenceShelfService()
    : previewEvidenceShelfService;

export function toPreviewPayload(
  result: KnowledgeContentSearchResult,
): EvidenceShelfPreviewPayload {
  return {
    contentUnitId: result.id,
    excerpt: result.excerpt,
    headingPath: result.headingPath,
    language: result.language,
    ordinal: result.ordinal,
    sourceId: result.sourceId,
    sourceType: result.sourceType,
    text: result.text,
    tokenCount: result.tokenCount,
    workTitle: result.workTitle,
  };
}

/**
 * Stable source identity used for UI membership across backup/import cycles.
 * ContentUnit ids are intentionally disposable and therefore excluded. The
 * anchor plus ordinal distinguishes adjacent units from the same revision;
 * canonical text is represented by a compact fingerprint in the stricter key.
 */
export function evidenceShelfSourceIdentityKey(
  value: KnowledgeContentSearchResult | EvidenceShelfItem,
): string {
  const source = shelfSourceParts(value);
  const { text: _text, ...identity } = source;
  return stableJson(identity);
}

/**
 * Adds a text fingerprint to the stable identity. This lets callers detect a
 * changed paragraph without exposing source text in a membership set. Use the
 * identity key as a compatibility fallback for imported previews whose text
 * was sanitized during backup transport.
 */
export function evidenceShelfSourceKey(
  value: KnowledgeContentSearchResult | EvidenceShelfItem,
): string {
  const source = shelfSourceParts(value);
  const { text, ...identity } = source;
  return stableJson({
    ...identity,
    textFingerprint: textFingerprint(text),
    textLength: text.length,
  });
}

/**
 * Backup sanitization may rewrite a preview's disposable text while leaving
 * its immutable source hash untouched. Only those explicitly marked previews
 * receive the identity-only membership fallback; ordinary changed text must
 * not be mistaken for the same staged result.
 */
export function evidenceShelfPreviewHasRedaction(item: EvidenceShelfItem): boolean {
  if (item.status === "stale" || item.isStale) return false;
  const preview = item.previewPayload;
  const text = `${preview.text}\n${preview.excerpt}`;
  return (
    text.includes("[redacted]") ||
    /(?:[?&]|\b)\w*(?:token|key|secret|password|credential|auth)\w*=redacted\b/i.test(text)
  );
}

/** Rehydrates a staged preview for exact Reader navigation after restart. */
export function knowledgeResultFromEvidenceShelfItem(
  item: EvidenceShelfItem,
): KnowledgeContentSearchResult | null {
  const payload = item.previewPayload;
  if (
    !payload ||
    payload.contentUnitId.trim() === "" ||
    payload.sourceId.trim() === "" ||
    payload.text.trim() === ""
  ) {
    return null;
  }
  return {
    anchor: item.anchorSnapshot,
    assetId: item.assetId,
    excerpt: payload.excerpt,
    headingPath: payload.headingPath,
    id: payload.contentUnitId,
    language: payload.language,
    ordinal: payload.ordinal,
    parentUnitId: null,
    revisionId: item.revisionId,
    score: 0,
    sourceId: payload.sourceId,
    sourceType: payload.sourceType,
    state: "ready",
    text: payload.text,
    tokenCount: payload.tokenCount,
    workId: item.workId,
    workTitle: payload.workTitle,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function throwPreviewWrite(signal: AbortSignal | undefined): never {
  signal?.throwIfAborted();
  throw new Error("Evidence Shelf 仅在桌面应用中可保存");
}

interface ShelfSourceParts {
  anchor: unknown;
  assetId: string | null;
  headingPath: string[] | null;
  ordinal: number;
  revisionId: string | null;
  sourceId: string;
  sourceType: EvidenceShelfPreviewPayload["sourceType"];
  text: string;
  workId: string | null;
}

function shelfSourceParts(
  value: KnowledgeContentSearchResult | EvidenceShelfItem,
): ShelfSourceParts {
  if ("previewPayload" in value) {
    const preview = value.previewPayload;
    return {
      anchor: value.anchorSnapshot,
      assetId: value.assetId,
      headingPath: preview.headingPath,
      ordinal: preview.ordinal,
      revisionId: value.revisionId,
      sourceId: preview.sourceId,
      sourceType: preview.sourceType,
      text: preview.text,
      workId: value.workId,
    };
  }
  return {
    anchor: value.anchor,
    assetId: value.assetId,
    headingPath: value.headingPath,
    ordinal: value.ordinal,
    revisionId: value.revisionId,
    sourceId: value.sourceId,
    sourceType: value.sourceType,
    text: value.text,
    workId: value.workId,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return "null";
}

function textFingerprint(value: string): string {
  // FNV-1a is intentionally only a UI discriminator; the canonical SHA-256
  // source hash remains the authority for stale/save validation in main/DB.
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
