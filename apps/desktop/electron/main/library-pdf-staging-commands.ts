import type {
  DataCommandOutput,
  DataCommandRequest,
  LibraryReleaseStagedPdfCommandInput,
  LibraryStagePdfCommandInput,
} from "../data-command-contract";
import { isRecord, requireRecordId, type DataCommandDependencies } from "./data-command-runtime";

type LibraryPdfStagingCommandName = "library.releaseStagedPdf" | "library.stagePdf";

type LibraryPdfStagingCommandRequest = Extract<
  DataCommandRequest,
  { name: LibraryPdfStagingCommandName }
>;

/** Renderer input carries no database lease; release may run guarded main-side blob GC. */
export async function executeLibraryPdfStagingCommand(
  request: LibraryPdfStagingCommandRequest,
  dependencies: DataCommandDependencies,
): Promise<DataCommandOutput<LibraryPdfStagingCommandName>> {
  if (request.name === "library.stagePdf") {
    if (!dependencies.stagePdf) throw new Error("Main-process PDF staging is unavailable");
    return dependencies.stagePdf(parseStagePdfInput(request.input).bytes);
  }
  if (!dependencies.releaseStagedPdf) {
    throw new Error("Main-process PDF staging is unavailable");
  }
  return {
    released: await dependencies.releaseStagedPdf(
      parseReleaseStagedPdfInput(request.input).stageId,
    ),
  };
}

function parseStagePdfInput(value: unknown): LibraryStagePdfCommandInput {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "bytes")) {
    throw new Error("Invalid library.stagePdf input");
  }
  const bytes = toUint8Array(value.bytes);
  if (bytes.byteLength === 0) throw new Error("PDF staging bytes are required");
  return { bytes };
}

function parseReleaseStagedPdfInput(value: unknown): LibraryReleaseStagedPdfCommandInput {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "stageId")) {
    throw new Error("Invalid library.releaseStagedPdf input");
  }
  return { stageId: requireRecordId(value.stageId, "PDF stage id") };
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("PDF staging bytes are invalid");
}
