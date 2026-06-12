// Sentinel state machine. States advance monotonically (skipping allowed):
//
//   accepted ─→ registered ─→ online ─→ in_issue
//                                 └─────→ indexed_openalex / indexed_pubmed (any order)
//
// Honest capability note: free APIs cannot confirm WoS/EI inclusion. We track
// proxy milestones (OpenAlex/PubMed indexing, complete volume/issue metadata)
// and label them as such in the UI. WoS Starter / Scopus integrations are a
// future paid feature.

export const SENTINEL_STATES = [
  "accepted", // user has the acceptance email + DOI, nothing resolvable yet
  "registered", // DOI resolves at Crossref
  "online", // published-online date exists / appears in OpenAlex
  "in_issue", // volume+issue/page assigned → formally published
  "indexed_openalex",
  "indexed_pubmed",
] as const;

export type SentinelState = (typeof SENTINEL_STATES)[number];

/** Rank for monotonic progression. indexed_* share a rank (order varies). */
const RANK: Record<SentinelState, number> = {
  accepted: 0,
  registered: 1,
  online: 2,
  in_issue: 3,
  indexed_openalex: 4,
  indexed_pubmed: 4,
};

export function stateRank(s: SentinelState): number {
  return RANK[s];
}

export const STATE_LABEL: Record<SentinelState, string> = {
  accepted: "已接收",
  registered: "DOI 已注册",
  online: "在线发表",
  in_issue: "正式出版(卷期页)",
  indexed_openalex: "OpenAlex 已收录",
  indexed_pubmed: "PubMed 已收录",
};

export interface MilestoneEvidence {
  state: SentinelState;
  /** Raw API payload snapshot — proof material for certification requests. */
  evidence: Record<string, unknown>;
  source: "crossref" | "openalex" | "pubmed";
}

export interface CheckOutcome {
  /** Milestones confirmed by this check (may be several at once). */
  reached: MilestoneEvidence[];
  /** Highest state implied by current API data. */
  highestState: SentinelState;
}

/**
 * Derives reached milestones from API snapshots. Pure — testable without HTTP.
 */
export function deriveMilestones(input: {
  crossref: Record<string, unknown> | null;
  openalex: Record<string, unknown> | null;
}): CheckOutcome {
  const reached: MilestoneEvidence[] = [];
  const cr = input.crossref;
  const oa = input.openalex;

  if (cr) {
    reached.push({ state: "registered", evidence: pick(cr, CR_EVIDENCE_KEYS), source: "crossref" });

    const onlineDate = (cr["published-online"] ?? cr["published"]) as
      | { "date-parts"?: unknown }
      | undefined;
    if (onlineDate?.["date-parts"]) {
      reached.push({ state: "online", evidence: pick(cr, CR_EVIDENCE_KEYS), source: "crossref" });
    }

    const hasIssue = Boolean(cr["volume"]) && Boolean(cr["issue"] ?? cr["page"]);
    if (hasIssue) {
      reached.push({ state: "in_issue", evidence: pick(cr, CR_EVIDENCE_KEYS), source: "crossref" });
    }
  }

  if (oa) {
    // Appearing in OpenAlex at all implies online availability.
    reached.push({
      state: "online",
      evidence: pick(oa, OA_EVIDENCE_KEYS),
      source: "openalex",
    });
    reached.push({
      state: "indexed_openalex",
      evidence: pick(oa, OA_EVIDENCE_KEYS),
      source: "openalex",
    });
    const ids = oa["ids"] as Record<string, unknown> | undefined;
    if (ids?.["pmid"]) {
      reached.push({ state: "indexed_pubmed", evidence: { pmid: ids["pmid"] }, source: "openalex" });
    }
  }

  const highestState = reached.reduce<SentinelState>(
    (best, m) => (stateRank(m.state) > stateRank(best) ? m.state : best),
    "accepted",
  );
  return { reached, highestState };
}

/** Adaptive polling: early stages move slowly; pre-indexing window polls more often. */
export function nextPollInterval(state: SentinelState, errorCount: number): number {
  const base: Record<SentinelState, number> = {
    accepted: 1 * 86_400, // DOI registration usually lands within days
    registered: 1 * 86_400,
    online: 3 * 86_400, // issue assignment takes weeks-months
    in_issue: 7 * 86_400, // indexing takes weeks
    indexed_openalex: 7 * 86_400,
    indexed_pubmed: 7 * 86_400,
  };
  // Exponential backoff on consecutive errors, capped at 4x.
  const errorMultiplier = Math.min(4, 1 + errorCount);
  // ±10% jitter to avoid synchronized fleets hammering APIs.
  const jitter = 0.9 + Math.random() * 0.2;
  return Math.round(base[state] * errorMultiplier * jitter);
}

/** Tasks reaching all interesting milestones can stop polling. */
export function isTerminal(state: SentinelState, targets: SentinelState[]): boolean {
  if (targets.length === 0) return stateRank(state) >= RANK.indexed_openalex;
  return targets.every((t) => stateRank(state) >= stateRank(t));
}

const CR_EVIDENCE_KEYS = [
  "DOI",
  "title",
  "container-title",
  "published",
  "published-online",
  "published-print",
  "volume",
  "issue",
  "page",
  "type",
  "ISSN",
  "indexed",
];
const OA_EVIDENCE_KEYS = [
  "id",
  "doi",
  "display_name",
  "publication_date",
  "ids",
  "primary_location",
  "indexed_in",
];

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
