import { parseSourceAnchor } from "@aurascholar/core";
import type { KnowledgeContentSearchResult } from "../../electron/data-command-contract";
import { getLibraryDb } from "./aura-db";

export interface KnowledgeSearchReaderTarget {
  assetId: string | null;
  pageIndex: number;
  revisionId: string;
  sourceId: string;
  sourceType: KnowledgeContentSearchResult["sourceType"];
  workId: string;
}

/**
 * Accepts only a revision-bound PDF anchor that agrees with the durable
 * ContentUnit metadata. This makes a search hit safe to turn into a Reader
 * deep link without treating FTS text as a source of truth.
 */
export function knowledgeSearchReaderTarget(
  result: KnowledgeContentSearchResult,
): KnowledgeSearchReaderTarget | null {
  const workId = nonBlank(result.workId);
  const revisionId = nonBlank(result.revisionId);
  const sourceId = nonBlank(result.sourceId);
  if (!workId || !revisionId || !sourceId) return null;

  const assetId = result.assetId === null ? null : nonBlank(result.assetId);
  if (result.assetId !== null && !assetId) return null;

  let anchor: ReturnType<typeof parseSourceAnchor>;
  try {
    anchor = parseSourceAnchor(result.anchor);
  } catch {
    return null;
  }
  if (anchor.kind !== "pdf" || anchor.revisionId !== revisionId) return null;

  switch (result.sourceType) {
    case "pdf":
      if (sourceId !== revisionId) return null;
      break;
    case "annotation":
    case "evidence":
      break;
    default:
      return null;
  }

  return {
    assetId,
    pageIndex: anchor.pageIndex,
    revisionId,
    sourceId,
    sourceType: result.sourceType,
    workId,
  };
}

/** Builds a Reader URL only after the exact revision's attachment is known. */
export function knowledgeSearchReaderPath(
  target: KnowledgeSearchReaderTarget,
  attachmentId: string,
): string | null {
  const attachment = nonBlank(attachmentId);
  if (!attachment) return null;

  const params = new URLSearchParams();
  params.set("attachment", attachment);
  if (target.sourceType === "annotation") params.set("annotation", target.sourceId);
  if (target.sourceType === "evidence") params.set("evidence", target.sourceId);
  params.set("page", String(target.pageIndex + 1));
  params.set("work", target.workId);
  return `/reader?${params.toString()}`;
}

/**
 * Resolves the exact PDF attachment before navigating. In particular, this
 * refuses to silently substitute a newer revision when an indexed hit points
 * at a historical revision that is unavailable locally.
 */
export async function resolveKnowledgeSearchReaderPath(
  result: KnowledgeContentSearchResult,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  const { signal } = options;
  throwIfAborted(signal);
  const target = knowledgeSearchReaderTarget(result);
  if (!target) return null;

  const { libraryId } = await getLibraryDb();
  throwIfAborted(signal);
  const response = await window.aura.data.command("document.resolveRevision", {
    libraryId,
    revisionId: target.revisionId,
    workId: target.workId,
  });
  throwIfAborted(signal);

  const revision = response.revision;
  if (
    !revision ||
    revision.revisionId !== target.revisionId ||
    revision.workId !== target.workId ||
    (target.assetId !== null && revision.assetId !== target.assetId) ||
    (revision.availabilityStatus !== "available" && revision.availabilityStatus !== "unchecked")
  ) {
    return null;
  }
  return knowledgeSearchReaderPath(target, revision.attachmentId ?? "");
}

function nonBlank(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
