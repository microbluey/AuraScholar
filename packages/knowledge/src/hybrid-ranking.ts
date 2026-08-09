/** A channel is already ordered by its own retrieval backend. */
export interface RetrievalRankChannel {
  id: string;
  candidates: readonly { contentUnitId: string }[];
  /** Relative channel importance; defaults to 1. */
  weight?: number;
}

export interface FusedRetrievalRank {
  contentUnitId: string;
  score: number;
  /** Diagnostic channel/rank pairs, never presented as a confidence percentage. */
  ranks: readonly { channelId: string; rank: number }[];
}

export interface ReciprocalRankFusionOptions {
  /** Standard RRF constant. A lower value intentionally emphasizes top ranks. */
  rankConstant?: number;
  limit?: number;
}

/**
 * Fuses only ranked candidates, never raw BM25 scores and cosine distances.
 * This keeps backend score scales incomparable by design and makes ties stable.
 */
export function reciprocalRankFusion(
  channels: readonly RetrievalRankChannel[],
  options: ReciprocalRankFusionOptions = {},
): FusedRetrievalRank[] {
  const rankConstant = options.rankConstant ?? 60;
  if (!Number.isFinite(rankConstant) || rankConstant < 0) {
    throw new Error("Reciprocal rank fusion constant must be a non-negative finite number");
  }
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Reciprocal rank fusion limit must be an integer between 1 and 1000");
  }

  const usedChannelIds = new Set<string>();
  const fused = new Map<string, { score: number; ranks: { channelId: string; rank: number }[] }>();
  for (const channel of channels) {
    assertNonEmpty(channel.id, "Retrieval channel id");
    if (usedChannelIds.has(channel.id)) {
      throw new Error(`Retrieval channel ${channel.id} was supplied more than once`);
    }
    usedChannelIds.add(channel.id);
    const weight = channel.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Retrieval channel ${channel.id} weight must be a positive finite number`);
    }

    const seenContentUnitIds = new Set<string>();
    for (const [position, candidate] of channel.candidates.entries()) {
      assertNonEmpty(candidate.contentUnitId, "Ranked ContentUnit id");
      if (seenContentUnitIds.has(candidate.contentUnitId)) {
        throw new Error(
          `ContentUnit ${candidate.contentUnitId} appears more than once in ${channel.id}`,
        );
      }
      seenContentUnitIds.add(candidate.contentUnitId);
      const rank = position + 1;
      const current = fused.get(candidate.contentUnitId) ?? { score: 0, ranks: [] };
      current.score += weight / (rankConstant + rank);
      current.ranks.push({ channelId: channel.id, rank });
      fused.set(candidate.contentUnitId, current);
    }
  }

  return [...fused.entries()]
    .map(([contentUnitId, value]) => ({ contentUnitId, ...value }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return compareText(left.contentUnitId, right.contentUnitId);
    })
    .slice(0, limit);
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
