import { findOaPdfCandidates } from "@aurascholar/core";
import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import type { NormalizedWork } from "@aurascholar/connectors";
import { PdfDocument } from "@aurascholar/reader";
import { getLibraryDb } from "./aura-db";
import { auraFs, auraHttp, blobPath, sha256Hex } from "./aura-platform";
import { connectorContext } from "./connector-context";
import type { OaLookupWork } from "./library-types";

export interface ValidatedOaPdf {
  bytes: Uint8Array;
  pageCount: number;
  url: string;
  via: string;
}

/** Tries legal OA candidates in priority order and rejects HTML/corrupt payloads. */
export async function fetchValidatedOaPdf(work: OaLookupWork): Promise<ValidatedOaPdf | null> {
  const candidates = await findOaPdfCandidates(
    connectorContext,
    work as NormalizedWork,
  ).catch(() => []);
  for (const candidate of candidates) {
    try {
      const response = await auraHttp.request({ url: candidate.url, timeoutMs: 60_000 });
      if (
        response.status !== 200 ||
        response.body.byteLength < 1024 ||
        !new TextDecoder().decode(response.body.slice(0, 5)).startsWith("%PDF")
      ) {
        continue;
      }
      const document = await PdfDocument.load(response.body.slice());
      const pageCount = document.pageCount;
      document.destroy();
      return { bytes: response.body, pageCount, url: candidate.url, via: candidate.via };
    } catch {
      // OA registries can return stale or paywalled URLs; continue to the next candidate.
    }
  }
  return null;
}

/** Returns true only for a readable local PDF or a newly persisted OA copy. */
export async function ensureOaPdfAttachment(
  workId: string,
  work: NormalizedWork,
): Promise<boolean> {
  const { db, libraryId } = await getLibraryDb();
  const attachments = new AttachmentsRepo(db, libraryId);
  const existing = await attachments.forWork(workId);
  for (const attachment of existing) {
    if (attachment.kind !== "pdf") continue;
    try {
      const path = blobPath(attachment.sha256);
      if (!(await auraFs.exists(path))) continue;
      const bytes = await auraFs.readFile(path);
      if (!new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF")) continue;
      const document = await PdfDocument.load(bytes.slice());
      document.destroy();
      return true;
    } catch {
      // A missing or corrupt content-addressed blob is repairable from OA sources.
    }
  }

  const oa = await fetchValidatedOaPdf(work);
  if (!oa) return false;
  const sha = await sha256Hex(oa.bytes);
  await auraFs.writeFile(blobPath(sha), oa.bytes);
  await attachments.create({
    workId,
    sha256: sha,
    byteSize: oa.bytes.byteLength,
    originalFilename: oaPdfFileName(work.title, oa.url),
    pageCount: oa.pageCount,
    sourceUrl: oa.url,
    fetchedVia: oa.via,
  });
  return true;
}

export function oaPdfFileName(title: string, sourceUrl: string): string {
  try {
    const candidate = decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() ?? "");
    if (/^[^/\\]{1,180}\.pdf$/i.test(candidate)) return candidate;
  } catch {
    // Fall through to a title-derived local filename.
  }
  const base = title.slice(0, 60).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "open-access-fulltext"}.pdf`;
}
