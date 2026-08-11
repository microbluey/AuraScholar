import { constants, promises as fs } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { WorksRepo, type WorkWithAuthors } from "@aurascholar/db/repos/works";
import { findOaPdfCandidates, type OaPdfCandidate, type OaPdfSource } from "@aurascholar/core";
import type { ConnectorContext, NormalizedWork } from "@aurascholar/connectors";
import type { LibraryStagePdfCommandResult } from "../library-ingest-command-contract";
import { assertActiveLocalLibrary, requireRecordId } from "./data-command-runtime";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import {
  claimLibraryStagedPdf,
  releaseLibraryStagedPdf,
  stageLibraryPdf,
  type StagedPdfClaim,
} from "./library-pdf-staging";
import { fetchPinnedOaPdf, type OaPdfDownload } from "./oa-pdf-http";
import { mainScholarlyHttp } from "./scholarly-http";
import { resolveScholarlyClue } from "./scholarly-commands";
import { verifyStagedPdf } from "./staged-pdf-verification";

const MAX_PDF_PAGE_COUNT = 100_000;
const OA_CONNECTOR_CONTEXT: ConnectorContext = {
  http: mainScholarlyHttp,
  mailto: "contact@aurascholar.app",
};

interface LocalOaWork {
  attachments: Array<{ byte_size: number; kind: string; sha256: string }>;
  work: WorkWithAuthors;
}

export interface LibraryOaPdfDependencies {
  /** Main-owned serial read used before any outbound lookup. */
  inspect<T>(operation: (database: Database) => Promise<T> | T): Promise<T>;
  /** Durable attach transaction, serialized with blob GC and all Library writes. */
  transaction<T>(operation: (database: Database) => Promise<T> | T): Promise<T>;
  claimStagedPdf(stageId: string): Promise<StagedPdfClaim>;
  fetchCandidate(candidate: OaPdfCandidate): Promise<OaPdfDownload | null>;
  findCandidates(work: WorkWithAuthors): Promise<OaPdfCandidate[]>;
  isReadableAttachment(attachment: {
    byte_size: number;
    kind: string;
    sha256: string;
  }): Promise<boolean>;
  pageCount(bytes: Uint8Array): Promise<number>;
  releaseStagedPdf(stageId: string): Promise<boolean>;
  stagePdf(bytes: Uint8Array): Promise<LibraryStagePdfCommandResult>;
  verifyStagedPdf(receipt: LibraryStagePdfCommandResult): Promise<void>;
}

const defaultDependencies: LibraryOaPdfDependencies = {
  inspect: withMainDatabase,
  transaction: (operation) =>
    withMainDatabaseTransaction("library.ensureOaPdfAttachment", operation),
  claimStagedPdf: claimLibraryStagedPdf,
  fetchCandidate: (candidate) => fetchPinnedOaPdf(candidate.url),
  findCandidates: findMainOaPdfCandidates,
  isReadableAttachment: isReadableCanonicalPdfAttachment,
  pageCount: pageCountForPdf,
  releaseStagedPdf: releaseLibraryStagedPdf,
  stagePdf: stageLibraryPdf,
  verifyStagedPdf,
};

/**
 * Main-only OA acquisition flow. It starts with an active local work and
 * returns a boolean only: bytes, candidate URLs, staging capabilities, and
 * publisher provenance never cross back to the renderer.
 */
export async function ensureMainOaPdfAttachment(
  workId: string,
  dependencies: LibraryOaPdfDependencies = defaultDependencies,
): Promise<boolean> {
  const normalizedWorkId = requireRecordId(workId, "Work id");
  const local = await dependencies.inspect((database) =>
    loadLocalOaWork(database, normalizedWorkId),
  );
  if (!local) return false;

  for (const attachment of local.attachments) {
    if (attachment.kind !== "pdf") continue;
    if (await dependencies.isReadableAttachment(attachment).catch(() => false)) return true;
  }

  const candidates = await dependencies.findCandidates(local.work).catch(() => []);
  for (const candidate of candidates) {
    try {
      const downloaded = await dependencies.fetchCandidate(candidate);
      if (!downloaded) continue;
      const pageCount = await dependencies.pageCount(downloaded.bytes);
      if (!Number.isSafeInteger(pageCount) || pageCount <= 0 || pageCount > MAX_PDF_PAGE_COUNT) {
        continue;
      }
      const attached = await stageAndAttachOaPdf(
        normalizedWorkId,
        candidate.via,
        downloaded,
        pageCount,
        dependencies,
      );
      if (attached) return true;
    } catch {
      // A registry may return a stale/paywalled/corrupt candidate. The public
      // capability deliberately preserves the previous `false` semantics.
    }
  }
  return false;
}

/**
 * Resolve OA candidates from only durable local metadata. The metadata
 * connector uses the fixed scholarly HTTP allowlist; the resulting publisher
 * PDF candidates are then fetched through the separately pinned transport.
 */
export async function findMainOaPdfCandidates(work: WorkWithAuthors): Promise<OaPdfCandidate[]> {
  const remote = await resolveRemoteOaMetadata(work);
  const localUrl = storedHttpsCandidate(work.url);
  const candidateWork: NormalizedWork = {
    arxivId: work.arxiv_id ?? undefined,
    authors: [],
    doi: work.doi ?? undefined,
    oaPdfUrl: remote?.oaPdfUrl,
    source: remote?.source ?? "crossref",
    title: work.title,
  };
  const candidates = await findOaPdfCandidates(OA_CONNECTOR_CONTEXT, candidateWork);
  if (localUrl && !candidates.some((candidate) => sameCandidateUrl(candidate.url, localUrl))) {
    // Existing full-text handoffs may retain a publisher's tokenized PDF URL
    // without a `.pdf` suffix. It is still only a candidate: the pinned
    // transport, PDF magic, and parser must all accept it before attachment.
    candidates.push({ url: localUrl, via: "openalex" });
  }
  return candidates;
}

async function resolveRemoteOaMetadata(work: WorkWithAuthors): Promise<NormalizedWork | null> {
  const clue = work.doi
    ? { kind: "doi" as const, doi: work.doi }
    : work.arxiv_id
      ? { arxivId: work.arxiv_id, kind: "arxiv" as const }
      : null;
  if (!clue) return null;
  return (await resolveScholarlyClue(clue).catch(() => null))?.work ?? null;
}

/** A durable HTTPS work URL is only a candidate; transport validates its bytes. */
function storedHttpsCandidate(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sameCandidateUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.toString() === rightUrl.toString();
  } catch {
    return left === right;
  }
}

async function loadLocalOaWork(database: Database, workId: string): Promise<LocalOaWork | null> {
  const libraryId = await requireActiveLocalLibraryId(database);
  const work = await new WorksRepo(database, libraryId).get(workId);
  if (!work || work.deleted_at !== null) return null;
  const attachments = await new AttachmentsRepo(database, libraryId).forWork(workId);
  return { attachments, work };
}

async function stageAndAttachOaPdf(
  workId: string,
  fetchedVia: OaPdfSource,
  downloaded: OaPdfDownload,
  pageCount: number,
  dependencies: LibraryOaPdfDependencies,
): Promise<boolean> {
  const receipt = await dependencies.stagePdf(downloaded.bytes);
  let claim: StagedPdfClaim | null = null;
  let consumed = false;
  try {
    const stagedClaim = await dependencies.claimStagedPdf(receipt.stageId);
    claim = stagedClaim;
    await dependencies.verifyStagedPdf(stagedClaim.receipt);
    const attached = await dependencies.transaction(async (database) => {
      const libraryId = await requireActiveLocalLibraryId(database);
      const work = await new WorksRepo(database, libraryId).get(workId);
      if (!work || work.deleted_at !== null) return false;
      await new AttachmentsRepo(database, libraryId).create({
        byteSize: stagedClaim.receipt.byteSize,
        fetchedVia,
        originalFilename: oaPdfFileName(work.title, downloaded.sourceUrl),
        pageCount,
        sha256: stagedClaim.receipt.sha,
        sourceUrl: downloaded.sourceUrl,
        workId,
      });
      return true;
    });
    if (!attached) return false;
    stagedClaim.consume();
    consumed = true;
    return true;
  } finally {
    if (!consumed) {
      claim?.release();
      await dependencies.releaseStagedPdf(receipt.stageId).catch(() => {});
    }
  }
}

/** Main-only, presentation-safe original filename derived from final provenance. */
export function oaPdfFileName(title: string, sourceUrl: string): string {
  try {
    const candidate = decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() ?? "");
    if (/^[^/\\]{1,180}\.pdf$/iu.test(candidate)) return candidate;
  } catch {
    // Fall through to a title-derived local filename.
  }
  const base = title
    .slice(0, 60)
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `${base || "open-access-fulltext"}.pdf`;
}

async function isReadableCanonicalPdfAttachment(attachment: {
  byte_size: number;
  sha256: string;
}): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/u.test(attachment.sha256) || attachment.byte_size <= 0) return false;
  await verifyStagedPdf({
    byteSize: attachment.byte_size,
    sha: attachment.sha256,
  });
  const target = join(
    app.getPath("userData"),
    "blobs",
    attachment.sha256.slice(0, 2),
    `${attachment.sha256}.pdf`,
  );
  const before = await fs.lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || hasMultipleLinks(before.nlink)) return false;
  const handle = await fs.open(target, readFlags());
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || hasMultipleLinks(opened.nlink) || !sameFile(before, opened))
      return false;
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
    return bytesRead === 5 && header.toString("ascii") === "%PDF-";
  } finally {
    await handle.close().catch(() => {});
  }
}

async function pageCountForPdf(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    // pdf.js can detach its input buffer, while staging needs the original
    // downloaded bytes after this validation step.
    data: bytes.slice(),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const document = await task.promise;
  try {
    return document.numPages;
  } finally {
    await document.destroy();
  }
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

function readFlags(): number {
  return process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
}

function hasMultipleLinks(linkCount: number | bigint): boolean {
  return typeof linkCount === "bigint" ? linkCount > 1n : linkCount > 1;
}

function sameFile(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}
