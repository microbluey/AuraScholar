import { parseSourceAnchor } from "@aurascholar/core";
import type { EvidenceRecord } from "@aurascholar/db/repos/evidence";
import type { ReaderAnnotation } from "@aurascholar/reader";
import type { ResolvedDocumentRevisionDto } from "../../../electron/data-command-contract";
import { getActiveResearchProjectLibraryId } from "../../services/research-projects";

export interface ReaderEvidenceDeepLinkInput {
  attachmentId: string;
  evidenceId: string;
  signal?: AbortSignal;
  workId: string;
}

export interface ReaderEvidenceDeepLinkResult {
  annotation: ReaderAnnotation;
  pageIndex: number;
}

export interface ReaderEvidenceDeepLinkDataSource {
  getEvidence(
    libraryId: string,
    evidenceId: string,
  ): Promise<{ evidence: EvidenceRecord | null }>;
  getLibraryId(signal?: AbortSignal): Promise<string>;
  resolveRevision(input: {
    attachmentId: string;
    libraryId: string;
    workId: string;
  }): Promise<{ revision: ResolvedDocumentRevisionDto | null }>;
}

export function resolveReaderScrollPage(input: {
  evidencePage?: number;
  page: number | null;
  translationPage: number | null;
}): number | null {
  return input.evidencePage ?? input.page ?? input.translationPage;
}

const defaultDataSource: ReaderEvidenceDeepLinkDataSource = {
  getEvidence: (libraryId, evidenceId) =>
    window.aura.data.command("evidence.get", { evidenceId, libraryId }),
  getLibraryId: (signal) => getActiveResearchProjectLibraryId({ signal }),
  resolveRevision: (input) =>
    window.aura.data.command("document.resolveAttachmentRevision", input),
};

export async function loadReaderEvidenceDeepLink(
  input: ReaderEvidenceDeepLinkInput,
  dataSource: ReaderEvidenceDeepLinkDataSource = defaultDataSource,
): Promise<ReaderEvidenceDeepLinkResult | null> {
  input.signal?.throwIfAborted();
  const libraryId = await dataSource.getLibraryId(input.signal);
  input.signal?.throwIfAborted();
  const [evidenceResult, revisionResult] = await Promise.all([
    dataSource.getEvidence(libraryId, input.evidenceId),
    dataSource.resolveRevision({
      attachmentId: input.attachmentId,
      libraryId,
      workId: input.workId,
    }),
  ]);
  input.signal?.throwIfAborted();
  const evidence = evidenceResult.evidence;
  const revision = revisionResult.revision;
  if (!evidence) return null;
  if (
    !revision ||
    evidence.workId !== input.workId ||
    evidence.revisionId !== revision.revisionId ||
    revision.attachmentId !== input.attachmentId
  ) {
    throw new Error("Evidence 深链与当前打开的原始修订不一致");
  }
  const sourceAnchor = parseSourceAnchor(evidence.anchor);
  if (sourceAnchor.kind !== "pdf" || sourceAnchor.revisionId !== evidence.revisionId) {
    throw new Error("Evidence 不包含可在 PDF 中定位的锚点");
  }
  return {
    annotation: {
      anchor: {
        pageIndex: sourceAnchor.pageIndex,
        position: sourceAnchor.position,
        quads: sourceAnchor.quads,
        quote: sourceAnchor.quote,
        version: 1,
      },
      color: "rgba(124, 92, 255, 0.3)",
      id: `evidence-preview:${evidence.id}`,
      pageIndex: sourceAnchor.pageIndex,
      type: "highlight",
    },
    pageIndex: sourceAnchor.pageIndex,
  };
}
