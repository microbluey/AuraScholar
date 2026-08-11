/**
 * A single discovery result's stable identifiers plus its renderer-computed
 * bibliographic fingerprint. The main process uses these only to resolve an
 * active local-Library status; this is not a general work-query DTO.
 */
export interface DiscoveryLibraryStatusProbe {
  arxivId?: string;
  doi?: string;
  fingerprint?: string;
  openalexId?: string;
  pmid?: string;
  s2Id?: string;
}

/** Keep each IPC request bounded; the renderer facade chunks larger result sets. */
export const MAX_DISCOVERY_LIBRARY_STATUS_PROBES = 200;

/** Positional probes preserve the Discovery result order without exposing a Library id. */
export interface DiscoveryGetLibraryStatusCommandInput {
  probes: DiscoveryLibraryStatusProbe[];
}

/**
 * One status for each requested probe. `hasPdf` can only be true when the
 * matched active work has an active PDF attachment in the local Library.
 */
export interface DiscoveryLibraryStatus {
  hasPdf: boolean;
  workId: string | null;
}

export interface DiscoveryGetLibraryStatusCommandResult {
  statuses: DiscoveryLibraryStatus[];
}

/** Discovery's active-Library read boundary, wired into DataCommandMap later. */
export interface DiscoveryLibraryStatusDataCommandMap {
  "discovery.getLibraryStatus": {
    input: DiscoveryGetLibraryStatusCommandInput;
    output: DiscoveryGetLibraryStatusCommandResult;
  };
}
