import { Buffer } from "node:buffer";
import { hasConflictingDiscoveryIdentifiers } from "@aurascholar/core";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { MAX_DISCOVERY_LIBRARY_STATUS_PROBES } from "../discovery-library-status-command-contract";
import type {
  DiscoveryGetLibraryStatusCommandInput,
  DiscoveryGetLibraryStatusCommandResult,
  DiscoveryLibraryStatus,
  DiscoveryLibraryStatusProbe,
} from "../discovery-library-status-command-contract";
import { assertActiveLocalLibrary, isRecord } from "./data-command-runtime";

const MAX_DISCOVERY_LIBRARY_STATUS_INPUT_BYTES = 1024 * 1024;
const MAX_DISCOVERY_LIBRARY_STATUS_OUTPUT_BYTES = 1024 * 1024;
const MAX_FINGERPRINT_LENGTH = 16 * 1024;
const MAX_IDENTIFIER_LENGTH = 2_048;
const PROBE_IDENTIFIER_FIELDS = ["arxivId", "doi", "openalexId", "pmid", "s2Id"] as const;
const PROBE_FIELDS = [...PROBE_IDENTIFIER_FIELDS, "fingerprint"] as const;

type ProbeIdentifierField = (typeof PROBE_IDENTIFIER_FIELDS)[number];

interface FingerprintLibraryCandidate {
  arxivId?: string;
  doi?: string;
  id: string;
  openalexId?: string;
  pmid?: string;
  s2Id?: string;
}

/** Narrow dispatcher adapter: parsing happens before it is asked for a DB lease. */
export type DiscoveryLibraryStatusQueryExecutor = (
  operation: (
    database: Database,
  ) => DiscoveryGetLibraryStatusCommandResult | Promise<DiscoveryGetLibraryStatusCommandResult>,
) => Promise<DiscoveryGetLibraryStatusCommandResult>;

/**
 * Parse before acquiring the database lease, then resolve discovery statuses
 * only in the durable active local Library. The dispatcher adapts its typed
 * command lease to this narrow executor.
 */
export async function executeDiscoveryLibraryStatusCommand(
  value: unknown,
  execute: DiscoveryLibraryStatusQueryExecutor,
): Promise<DiscoveryGetLibraryStatusCommandResult> {
  const input = parseDiscoveryGetLibraryStatusInput(value);
  if (input.probes.length === 0) {
    return requireBoundedDiscoveryLibraryStatusOutput({ statuses: [] }, 0);
  }
  return execute(async (database) => {
    const libraryId = await requireActiveLocalLibraryId(database);
    return loadDiscoveryLibraryStatuses(database, libraryId, input);
  });
}

export function parseDiscoveryGetLibraryStatusInput(
  value: unknown,
): DiscoveryGetLibraryStatusCommandInput {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "probes")) {
    throw new Error("Invalid discovery.getLibraryStatus input");
  }
  if (!Array.isArray(value.probes) || value.probes.length > MAX_DISCOVERY_LIBRARY_STATUS_PROBES) {
    throw new Error(
      `Discovery Library status probes are limited to ${MAX_DISCOVERY_LIBRARY_STATUS_PROBES}`,
    );
  }
  const probes = value.probes.map((probe, index) => parseDiscoveryLibraryStatusProbe(probe, index));
  const input = { probes };
  requireBoundedBytes(
    input,
    MAX_DISCOVERY_LIBRARY_STATUS_INPUT_BYTES,
    "Discovery Library status input",
  );
  return input;
}

function parseDiscoveryLibraryStatusProbe(
  value: unknown,
  index: number,
): DiscoveryLibraryStatusProbe {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (field) => !PROBE_FIELDS.includes(field as (typeof PROBE_FIELDS)[number]),
    )
  ) {
    throw new Error(`Discovery Library status probe at index ${index} is invalid`);
  }
  const probe: DiscoveryLibraryStatusProbe = {};
  for (const field of PROBE_IDENTIFIER_FIELDS) {
    const identifier = optionalProbeText(value, field, index, MAX_IDENTIFIER_LENGTH);
    if (identifier !== undefined) probe[field] = identifier;
  }
  const fingerprint = optionalProbeText(value, "fingerprint", index, MAX_FINGERPRINT_LENGTH);
  if (fingerprint !== undefined) probe.fingerprint = fingerprint;
  return probe;
}

function optionalProbeText(
  value: Record<string, unknown>,
  field: (typeof PROBE_FIELDS)[number],
  index: number,
  maxLength: number,
): string | undefined {
  if (!Object.hasOwn(value, field)) return undefined;
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > maxLength) {
    throw new Error(`Discovery Library status ${field} at index ${index} is invalid`);
  }
  return candidate;
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function loadDiscoveryLibraryStatuses(
  database: Database,
  libraryId: string,
  input: DiscoveryGetLibraryStatusCommandInput,
): Promise<DiscoveryGetLibraryStatusCommandResult> {
  const directMatches = await loadDirectIdentifierMatches(database, libraryId, input.probes);
  const fingerprintCandidates = await loadFingerprintCandidates(database, libraryId, input.probes);
  const workIds = input.probes.map((probe) =>
    findDiscoveryLibraryWorkId(probe, directMatches, fingerprintCandidates),
  );
  const workIdsWithPdf = await loadActivePdfWorkIds(database, libraryId, workIds);
  const statuses = workIds.map(
    (workId): DiscoveryLibraryStatus => ({
      hasPdf: workId !== undefined && workIdsWithPdf.has(workId),
      workId: workId ?? null,
    }),
  );
  return requireBoundedDiscoveryLibraryStatusOutput({ statuses }, input.probes.length);
}

async function loadDirectIdentifierMatches(
  database: Database,
  libraryId: string,
  probes: readonly DiscoveryLibraryStatusProbe[],
): Promise<Record<ProbeIdentifierField, Map<string, string>>> {
  const entries = await Promise.all(
    PROBE_IDENTIFIER_FIELDS.map(async (field) => {
      const values = uniqueProbeValues(probes, field);
      const matches = await loadDirectIdentifierFieldMatches(database, libraryId, field, values);
      return [field, matches] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<ProbeIdentifierField, Map<string, string>>;
}

function uniqueProbeValues(
  probes: readonly DiscoveryLibraryStatusProbe[],
  field: keyof DiscoveryLibraryStatusProbe,
): string[] {
  return [...new Set(probes.flatMap((probe) => (probe[field] ? [probe[field]!] : [])))];
}

async function loadDirectIdentifierFieldMatches(
  database: Database,
  libraryId: string,
  field: ProbeIdentifierField,
  values: readonly string[],
): Promise<Map<string, string>> {
  if (values.length === 0) return new Map();
  const column = identifierColumn(field);
  const rows = await database.query<{ id: string; value: string }>(
    `SELECT id, ${column} AS value
     FROM works
     WHERE library_id = ?
       AND ${column} IN (${values.map(() => "?").join(",")})
       AND deleted_at IS NULL`,
    [libraryId, ...values],
  );
  return new Map(rows.map((row) => [row.value.toLowerCase(), row.id]));
}

function identifierColumn(field: ProbeIdentifierField): string {
  switch (field) {
    case "arxivId":
      return "arxiv_id";
    case "doi":
      return "doi";
    case "openalexId":
      return "openalex_id";
    case "pmid":
      return "pmid";
    case "s2Id":
      return "s2_id";
  }
}

async function loadFingerprintCandidates(
  database: Database,
  libraryId: string,
  probes: readonly DiscoveryLibraryStatusProbe[],
): Promise<Map<string, FingerprintLibraryCandidate[]>> {
  const fingerprints = uniqueProbeValues(probes, "fingerprint");
  if (fingerprints.length === 0) return new Map();
  const rows = await database.query<{
    arxiv_id: string | null;
    doi: string | null;
    fingerprint: string;
    id: string;
    openalex_id: string | null;
    pmid: string | null;
    s2_id: string | null;
  }>(
    `SELECT id, fingerprint, doi, arxiv_id, openalex_id, s2_id, pmid
     FROM works
     WHERE library_id = ?
       AND fingerprint IN (${fingerprints.map(() => "?").join(",")})
       AND deleted_at IS NULL`,
    [libraryId, ...fingerprints],
  );
  const byFingerprint = new Map<string, FingerprintLibraryCandidate[]>();
  for (const row of rows) {
    const candidate: FingerprintLibraryCandidate = {
      arxivId: row.arxiv_id ?? undefined,
      doi: row.doi ?? undefined,
      id: row.id,
      openalexId: row.openalex_id ?? undefined,
      pmid: row.pmid ?? undefined,
      s2Id: row.s2_id ?? undefined,
    };
    const candidates = byFingerprint.get(row.fingerprint);
    if (candidates) candidates.push(candidate);
    else byFingerprint.set(row.fingerprint, [candidate]);
  }
  return byFingerprint;
}

function findDiscoveryLibraryWorkId(
  probe: DiscoveryLibraryStatusProbe,
  directMatches: Record<ProbeIdentifierField, Map<string, string>>,
  fingerprintCandidates: ReadonlyMap<string, readonly FingerprintLibraryCandidate[]>,
): string | undefined {
  const directId =
    (probe.doi ? directMatches.doi.get(probe.doi.toLowerCase()) : undefined) ??
    (probe.arxivId ? directMatches.arxivId.get(probe.arxivId.toLowerCase()) : undefined) ??
    (probe.openalexId ? directMatches.openalexId.get(probe.openalexId.toLowerCase()) : undefined) ??
    (probe.s2Id ? directMatches.s2Id.get(probe.s2Id.toLowerCase()) : undefined) ??
    (probe.pmid ? directMatches.pmid.get(probe.pmid.toLowerCase()) : undefined);
  if (directId) return directId;
  const candidates = probe.fingerprint ? fingerprintCandidates.get(probe.fingerprint) : undefined;
  return uniqueCompatibleFingerprintWorkId(probe, candidates);
}

function uniqueCompatibleFingerprintWorkId(
  probe: DiscoveryLibraryStatusProbe,
  candidates: readonly FingerprintLibraryCandidate[] | undefined,
): string | undefined {
  const compatibleIds = new Set(
    candidates
      ?.filter((candidate) => !hasConflictingDiscoveryIdentifiers(probe, candidate))
      .map((candidate) => candidate.id),
  );
  return compatibleIds.size === 1 ? compatibleIds.values().next().value : undefined;
}

async function loadActivePdfWorkIds(
  database: Database,
  libraryId: string,
  workIds: readonly (string | undefined)[],
): Promise<Set<string>> {
  const ids = [...new Set(workIds.filter((workId): workId is string => workId !== undefined))];
  if (ids.length === 0) return new Set();
  const rows = await database.query<{ work_id: string }>(
    `SELECT DISTINCT a.work_id
     FROM attachments a
     JOIN works w
       ON w.id = a.work_id
      AND w.library_id = ?
      AND w.deleted_at IS NULL
     WHERE a.work_id IN (${ids.map(() => "?").join(",")})
       AND a.kind = 'pdf'
       AND a.deleted_at IS NULL`,
    [libraryId, ...ids],
  );
  return new Set(rows.map((row) => row.work_id));
}

function requireBoundedDiscoveryLibraryStatusOutput(
  output: DiscoveryGetLibraryStatusCommandResult,
  expectedLength: number,
): DiscoveryGetLibraryStatusCommandResult {
  if (output.statuses.length !== expectedLength) {
    throw new Error("Discovery Library status output does not match the request");
  }
  for (const status of output.statuses) {
    if (status.workId === null && status.hasPdf) {
      throw new Error("Unmatched Discovery status cannot report a PDF");
    }
  }
  requireBoundedBytes(
    output,
    MAX_DISCOVERY_LIBRARY_STATUS_OUTPUT_BYTES,
    "Discovery Library status output",
  );
  return output;
}

function requireBoundedBytes(value: unknown, maximum: number, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} cannot be serialized`);
  }
  if (Buffer.byteLength(serialized, "utf8") > maximum) {
    throw new Error(`${label} is limited to ${maximum} bytes`);
  }
}
