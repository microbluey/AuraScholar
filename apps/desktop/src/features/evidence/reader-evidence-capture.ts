import type { EvidenceKind } from "@aurascholar/db/repos/evidence";
import type { ReaderEvidenceSelection } from "@aurascholar/reader";
import type {
  ResearchProjectSummary,
  SaveTextEvidenceCommandInput,
  SaveTextEvidenceCommandResult,
} from "../../../electron/data-command-contract";

export interface ReaderEvidenceSource {
  attachmentId: string;
  expectedBlobSha256: string;
  workId: string;
  workTitle: string;
}

export interface ReaderEvidenceCaptureScope {
  libraryId: string;
  projects: ResearchProjectSummary[];
}

export interface ReaderEvidenceCaptureGateway {
  loadScope(signal: AbortSignal): Promise<ReaderEvidenceCaptureScope>;
  save(
    input: SaveTextEvidenceCommandInput,
    signal: AbortSignal,
  ): Promise<SaveTextEvidenceCommandResult>;
}

export interface ReaderEvidenceSessionGuard {
  isCurrent(): boolean;
  signal: AbortSignal;
}

export type ReaderEvidenceCommitResult =
  | { result: SaveTextEvidenceCommandResult; status: "saved" }
  | { status: "stale" };

export const readerEvidenceCaptureGateway: ReaderEvidenceCaptureGateway = {
  async loadScope(signal) {
    requireCurrent(signal, () => true);
    const { libraryId } = await window.aura.data.command("project.getScope", {});
    requireCurrent(signal, () => true);
    const { projects } = await window.aura.data.command("project.list", { libraryId });
    requireCurrent(signal, () => true);
    return {
      libraryId,
      projects: projects.filter((project) => project.status === "active"),
    };
  },
  async save(input, signal) {
    requireCurrent(signal, () => true);
    const result = await window.aura.data.command("evidence.saveText", input);
    requireCurrent(signal, () => true);
    return result;
  },
};

export function buildReaderEvidenceCommand(input: {
  evidenceId: string;
  evidenceKind: EvidenceKind;
  libraryId: string;
  projectId: string | null;
  selection: ReaderEvidenceSelection;
  source: ReaderEvidenceSource;
}): SaveTextEvidenceCommandInput {
  return {
    anchor: input.selection.anchor,
    attachmentId: input.source.attachmentId,
    captureMethod: "reader-selection",
    evidenceId: input.evidenceId,
    evidenceKind: input.evidenceKind,
    expectedBlobSha256: input.source.expectedBlobSha256,
    libraryId: input.libraryId,
    projectId: input.projectId,
    tags: [],
    text: input.selection.exact,
    title: null,
    workId: input.source.workId,
  };
}

export async function commitReaderEvidence(input: {
  command: SaveTextEvidenceCommandInput;
  gateway?: ReaderEvidenceCaptureGateway;
  session: ReaderEvidenceSessionGuard;
}): Promise<ReaderEvidenceCommitResult> {
  const gateway = input.gateway ?? readerEvidenceCaptureGateway;
  if (!sessionIsCurrent(input.session)) return { status: "stale" };
  const result = await gateway.save(input.command, input.session.signal);
  if (!sessionIsCurrent(input.session)) return { status: "stale" };
  return { result, status: "saved" };
}

function sessionIsCurrent(session: ReaderEvidenceSessionGuard): boolean {
  return !session.signal.aborted && session.isCurrent();
}

function requireCurrent(signal: AbortSignal, isCurrent: () => boolean): void {
  signal.throwIfAborted();
  if (!isCurrent()) throw new DOMException("Reader session changed", "AbortError");
}
