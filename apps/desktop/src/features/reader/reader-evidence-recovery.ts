import type {
  RecoverEvidenceSourceInput,
  RecoverEvidenceSourceResult,
} from "../../../electron/shared";
import { getActiveResearchProjectLibraryId } from "../../services/research-projects";

export interface ReaderEvidenceRecoveryGateway {
  getLibraryId(signal?: AbortSignal): Promise<string>;
  recover(input: RecoverEvidenceSourceInput): Promise<RecoverEvidenceSourceResult>;
}

const defaultGateway: ReaderEvidenceRecoveryGateway = {
  getLibraryId: (signal) => getActiveResearchProjectLibraryId({ signal }),
  recover: (input) => window.aura.evidence.recoverSource(input),
};

export async function recoverReaderEvidenceSource(
  input: {
    evidenceId: string;
    expectedWorkId: string;
    file: File;
    signal?: AbortSignal;
  },
  gateway: ReaderEvidenceRecoveryGateway = defaultGateway,
): Promise<RecoverEvidenceSourceResult> {
  input.signal?.throwIfAborted();
  const [libraryId, buffer] = await Promise.all([
    gateway.getLibraryId(input.signal),
    input.file.arrayBuffer(),
  ]);
  input.signal?.throwIfAborted();
  const result = await gateway.recover({
    bytes: new Uint8Array(buffer),
    evidenceId: input.evidenceId,
    fileName: input.file.name,
    libraryId,
  });
  input.signal?.throwIfAborted();
  if (result.workId !== input.expectedWorkId || result.evidenceId !== input.evidenceId) {
    throw new Error("恢复结果与当前 Evidence 阅读会话不一致");
  }
  return result;
}
