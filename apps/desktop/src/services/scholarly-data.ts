import type {
  CitationGraphBuildCommandInput,
  CitationGraphBuildCommandResult,
  LibraryResolveClueCommandInput,
  LibraryResolveClueCommandResult,
  ScholarEnrichByDoiCommandInput,
  ScholarEnrichByDoiCommandResult,
  ScholarlyDataCommandInput,
  ScholarlyDataCommandOutput,
  ScholarlySearchDiscoveryCommandInput,
  ScholarlySearchDiscoveryCommandResult,
} from "../../electron/scholarly-command-contract";

type CancellableScholarlyCommandName =
  | "citationGraph.build"
  | "discovery.searchOpenSources"
  | "library.resolveClue"
  | "scholar.enrichByDoi";

type CancellableScholarlyCommandInput<K extends CancellableScholarlyCommandName> = Omit<
  ScholarlyDataCommandInput<K>,
  "requestId"
>;

/** Main-owned public scholarly API invocation; the renderer only sends typed intent. */
export function buildScholarlyCitationGraph(
  input: Omit<CitationGraphBuildCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<CitationGraphBuildCommandResult> {
  return invokeCancellableScholarlyCommand("citationGraph.build", input, signal);
}

/** Main-owned Crossref/OpenAlex/S2/arXiv discovery search. */
export function searchScholarlyOpenSources(
  input: Omit<ScholarlySearchDiscoveryCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<ScholarlySearchDiscoveryCommandResult> {
  return invokeCancellableScholarlyCommand("discovery.searchOpenSources", input, signal);
}

/** Main-owned Semantic Scholar enrichment request. */
export function enrichScholarByDoi(
  input: Omit<ScholarEnrichByDoiCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<ScholarEnrichByDoiCommandResult> {
  return invokeCancellableScholarlyCommand("scholar.enrichByDoi", input, signal);
}

/** Main-owned DOI/arXiv/title metadata resolution for interactive Library ingest. */
export function resolveLibraryScholarlyClue(
  input: Omit<LibraryResolveClueCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<LibraryResolveClueCommandResult> {
  return invokeCancellableScholarlyCommand("library.resolveClue", input, signal);
}

async function invokeCancellableScholarlyCommand<K extends CancellableScholarlyCommandName>(
  name: K,
  input: CancellableScholarlyCommandInput<K>,
  signal?: AbortSignal,
): Promise<ScholarlyDataCommandOutput<K>> {
  if (signal?.aborted) throw abortError();
  const requestId = newScholarlyRequestId();
  let cancellationRequested = false;
  const cancel = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    // The original request stays authoritative for the user-visible outcome;
    // main may have crossed a short completion boundary when this arrives.
    void window.aura.data.command("scholarly.cancelRun", { requestId }).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await window.aura.data.command(name, {
      ...input,
      requestId,
    } as ScholarlyDataCommandInput<K>);
    if (signal?.aborted) throw abortError();
    return result as ScholarlyDataCommandOutput<K>;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function newScholarlyRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `scholarly-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  const error = new Error("Scholarly request cancelled");
  error.name = "AbortError";
  return error;
}
