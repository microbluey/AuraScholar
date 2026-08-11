import type { DataCommandRequest } from "../data-command-contract";
import type {
  LibraryEnsureOaPdfAttachmentCommandInput,
  LibraryEnsureOaPdfAttachmentCommandResult,
} from "../library-oa-command-contract";
import { isRecord, requireRecordId } from "./data-command-runtime";
import { ensureMainOaPdfAttachment, type LibraryOaPdfDependencies } from "./library-oa-pdf";

export type LibraryOaCommandName = "library.ensureOaPdfAttachment";
export type LibraryOaCommandRequest = Extract<DataCommandRequest, { name: LibraryOaCommandName }>;

/**
 * Public OA action: the renderer has only a local work identity. Main owns
 * lookup, publisher transport, canonical staging, and durable attachment.
 */
export async function executeLibraryOaCommand(
  request: LibraryOaCommandRequest,
  dependencies?: LibraryOaPdfDependencies,
): Promise<LibraryEnsureOaPdfAttachmentCommandResult> {
  if (request.name !== "library.ensureOaPdfAttachment") {
    throw new Error("Unsupported Library OA command");
  }
  const input = parseLibraryEnsureOaPdfAttachmentInput(request.input);
  return { attached: await ensureMainOaPdfAttachment(input.workId, dependencies) };
}

export function parseLibraryEnsureOaPdfAttachmentInput(
  value: unknown,
): LibraryEnsureOaPdfAttachmentCommandInput {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "workId")) {
    throw new Error("Invalid library.ensureOaPdfAttachment input");
  }
  return { workId: requireRecordId(value.workId, "Work id") };
}
