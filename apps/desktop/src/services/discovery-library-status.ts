import type { DiscoveryResult } from "@aurascholar/core";
import type { NormalizedWork } from "@aurascholar/connectors";
import { workFingerprint } from "@aurascholar/db/ids";
import type { DataCommandMap } from "../../electron/data-command-contract";
import { MAX_DISCOVERY_LIBRARY_STATUS_PROBES } from "../../electron/discovery-library-status-command-contract";
import type { DiscoveryLibraryStatusProbe } from "../../electron/discovery-library-status-command-contract";

type DiscoveryLibraryStatusCommand = DataCommandMap["discovery.getLibraryStatus"];

/** Narrow injectable client for the now centrally typed Discovery command. */
export interface DiscoveryLibraryStatusCommandClient {
  command(
    name: "discovery.getLibraryStatus",
    input: DiscoveryLibraryStatusCommand["input"],
  ): Promise<DiscoveryLibraryStatusCommand["output"]>;
}

export interface LoadDiscoveryLibraryStatusOptions {
  signal?: AbortSignal;
}

/** Turns Discovery results into bounded, positional stable-identifier probes. */
export function discoveryLibraryStatusInput(
  results: readonly DiscoveryResult[],
): DiscoveryLibraryStatusCommand["input"] {
  return { probes: results.map((result) => discoveryLibraryStatusProbe(result.work)) };
}

export function discoveryLibraryStatusProbe(work: NormalizedWork): DiscoveryLibraryStatusProbe {
  const fingerprint = fingerprintForDiscoveryWork(work);
  return {
    ...(work.arxivId ? { arxivId: work.arxivId } : {}),
    ...(work.doi ? { doi: work.doi } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    ...(work.openalexId ? { openalexId: work.openalexId } : {}),
    ...(work.pmid ? { pmid: work.pmid } : {}),
    ...(work.s2Id ? { s2Id: work.s2Id } : {}),
  };
}

/**
 * The IPC bridge cannot cancel a completed main read, but checking around it
 * preserves search supersession: aborted Discovery requests never apply an
 * older status map after their command resolves.
 */
export async function loadDiscoveryLibraryStatuses(
  client: DiscoveryLibraryStatusCommandClient,
  input: DiscoveryLibraryStatusCommand["input"],
  options: LoadDiscoveryLibraryStatusOptions = {},
): Promise<DiscoveryLibraryStatusCommand["output"]> {
  options.signal?.throwIfAborted();
  const statuses: DiscoveryLibraryStatusCommand["output"]["statuses"] = [];
  for (let start = 0; start < input.probes.length; start += MAX_DISCOVERY_LIBRARY_STATUS_PROBES) {
    options.signal?.throwIfAborted();
    const probes = input.probes.slice(start, start + MAX_DISCOVERY_LIBRARY_STATUS_PROBES);
    const result = await client.command("discovery.getLibraryStatus", { probes });
    if (result.statuses.length !== probes.length) {
      throw new Error("Discovery Library status command returned an invalid positional mapping");
    }
    statuses.push(...result.statuses);
  }
  options.signal?.throwIfAborted();
  return { statuses };
}

function fingerprintForDiscoveryWork(work: NormalizedWork): string | null {
  const firstAuthor = work.authors[0]?.family ?? work.authors[0]?.displayName?.split(/\s+/).pop();
  if (!work.title) return null;
  return workFingerprint(work.title, work.year ?? null, firstAuthor ?? null);
}
