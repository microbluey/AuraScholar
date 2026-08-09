import type { FusedRetrievalRank } from "./hybrid-ranking.js";

/** The two explicitly supported language-routing labels in the first product slice. */
export const RETRIEVAL_PREFERENCE_LANGUAGES = ["zh", "en"] as const;
export type RetrievalPreferenceLanguage = (typeof RETRIEVAL_PREFERENCE_LANGUAGES)[number];

export interface RetrievalLanguageIntent {
  /** The language the query explicitly asks to prefer for returned material. */
  readonly language: RetrievalPreferenceLanguage;
  /** The exact user-language phrase that activated the preference. */
  readonly matchedPhrase: string;
}

export interface RetrievalLanguagePreferenceResult {
  /** Candidates after adding the explicit language preference signal. */
  readonly candidates: FusedRetrievalRank[];
  /** Number of candidates with a recognized requested-language label. */
  readonly matchedCandidateCount: number;
  /** False when no candidate had a recognized requested-language label. */
  readonly applied: boolean;
}

export interface RetrievalLanguagePreferenceOptions {
  preferredLanguage: RetrievalPreferenceLanguage;
  languageByContentUnitId: ReadonlyMap<string, string | null | undefined>;
  /** Extra RRF-equivalent weight for the explicit preference channel. */
  weight?: number;
  /** Kept aligned with the normal RRF constant unless a caller explicitly tunes it. */
  rankConstant?: number;
}

const CJK_LANGUAGE_LABEL = "(?:中文|汉语|華語|华语|简体中文|繁体中文)";
const ENGLISH_LANGUAGE_LABEL = "(?:英文|英语)";
const LATIN_LANGUAGE_LABEL = "(?:Chinese|English)(?:[- ]language)?";
const CJK_MATERIAL_NOUN =
  "(?:资料|資料|文献|文獻|材料|来源|來源|内容|內容|原文|论文|論文|文章|档案|檔案|摘要|报告|報告|记录|記錄|书籍|書籍|文本|文档|文件)";
const CJK_RESEARCH_CONTEXT = "研究(?:中|里|裏|内|內)";
const LATIN_MATERIAL_NOUN =
  "(?:sources?|papers?|literature|materials?|documents?|content|articles?|records?|archives?|abstracts?|reports?|texts?)";
const LATIN_QUERY_TARGET_NOUN = `(?:${LATIN_MATERIAL_NOUN}|methods?|explanations?|process(?:es)?|concepts?|principles?|notes?|effects?|measures?|techniques?|arrangements?|designs?|accounts?|descriptions?|passages?|definitions?|phenomena?|findings?)`;

/**
 * Maps common bibliographic language values to the compact routing labels.
 * Unknown values intentionally remain neutral: guessing a language from a
 * locale-like string would silently change a user's result set.
 */
export function normalizeRetrievalPreferenceLanguage(
  value: string | null | undefined,
): RetrievalPreferenceLanguage | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return null;
  if (
    normalized === "zh" ||
    normalized.startsWith("zh-") ||
    normalized === "cmn" ||
    normalized === "chi" ||
    normalized === "zho" ||
    /^(?:中文|汉语|華語|华语|简体中文|繁体中文)$/.test(normalized)
  ) {
    return "zh";
  }
  if (
    normalized === "en" ||
    normalized.startsWith("en-") ||
    normalized === "eng" ||
    normalized === "英语" ||
    normalized === "英文" ||
    normalized === "english"
  ) {
    return "en";
  }
  if (normalized === "chinese") return "zh";
  return null;
}

/**
 * Detects only an affirmative material-language request. A bare language word
 * or a request such as “用英文回答” is deliberately not treated as a corpus
 * routing instruction; those describe the conversation, not the source text.
 */
export function parseRetrievalLanguageIntent(query: string): RetrievalLanguageIntent | null {
  if (typeof query !== "string" || !query.trim()) return null;
  const normalized = query.trim();

  const cjk = findCjkLanguageIntent(normalized);
  const latin = findLatinLanguageIntent(normalized);
  if (cjk && latin && cjk.language !== latin.language) return null;
  return cjk ?? latin;
}

/**
 * Adds a separate, inspectable preference channel to an already fused rank.
 * It never removes non-matching candidates and it never changes the default
 * ordering when the query has no explicit language intent.
 */
export function applyRetrievalLanguagePreference(
  candidates: readonly FusedRetrievalRank[],
  options: RetrievalLanguagePreferenceOptions,
): RetrievalLanguagePreferenceResult {
  const rankConstant = options.rankConstant ?? 60;
  const weight = options.weight ?? 2;
  if (!Number.isFinite(rankConstant) || rankConstant < 0) {
    throw new Error("Retrieval language preference rank constant must be non-negative");
  }
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("Retrieval language preference weight must be positive");
  }

  const preferenceRanks = new Map<string, number>();
  for (const candidate of candidates) {
    if (preferenceRanks.has(candidate.contentUnitId)) continue;
    const language = normalizeRetrievalPreferenceLanguage(
      options.languageByContentUnitId.get(candidate.contentUnitId),
    );
    if (language === options.preferredLanguage) {
      preferenceRanks.set(candidate.contentUnitId, preferenceRanks.size + 1);
    }
  }

  if (preferenceRanks.size === 0) {
    return { applied: false, candidates: [...candidates], matchedCandidateCount: 0 };
  }

  const reranked = candidates.map((candidate, originalPosition) => {
    const preferenceRank = preferenceRanks.get(candidate.contentUnitId);
    if (preferenceRank === undefined) {
      return { candidate, originalPosition, score: candidate.score };
    }
    if (candidate.ranks.some(({ channelId }) => channelId === "language-preference")) {
      throw new Error("Retrieval language preference was applied more than once");
    }
    return {
      candidate: {
        ...candidate,
        score: candidate.score + weight / (rankConstant + preferenceRank),
        ranks: [...candidate.ranks, { channelId: "language-preference", rank: preferenceRank }],
      },
      originalPosition,
      score: candidate.score + weight / (rankConstant + preferenceRank),
    };
  });

  reranked.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    if (left.originalPosition !== right.originalPosition) {
      return left.originalPosition - right.originalPosition;
    }
    return compareText(left.candidate.contentUnitId, right.candidate.contentUnitId);
  });
  return {
    applied: true,
    candidates: reranked.map(({ candidate }) => candidate),
    matchedCandidateCount: preferenceRanks.size,
  };
}

function findCjkLanguageIntent(query: string): RetrievalLanguageIntent | null {
  const pattern = new RegExp(
    `(${CJK_LANGUAGE_LABEL}|${ENGLISH_LANGUAGE_LABEL})(?:的|之|[- ]|[\\p{Script=Han}]){0,24}?(?:${CJK_MATERIAL_NOUN}|${CJK_RESEARCH_CONTEXT})`,
    "u",
  );
  const match = pattern.exec(query);
  if (!match || isNegated(query, match.index)) return null;
  return { language: languageFromCjkLabel(match[1]!), matchedPhrase: match[0] };
}

function findLatinLanguageIntent(query: string): RetrievalLanguageIntent | null {
  const materialPattern = new RegExp(
    `\\b(${LATIN_LANGUAGE_LABEL})(?:[- ]+[a-z-]+){0,3}\\s+${LATIN_QUERY_TARGET_NOUN}\\b`,
    "iu",
  );
  const materialMatch = materialPattern.exec(query);
  if (materialMatch && !isNegated(query, materialMatch.index)) {
    return {
      language: languageFromLatinLabel(materialMatch[1]!),
      matchedPhrase: materialMatch[0],
    };
  }

  const prepositionPattern = new RegExp(
    `\\b(?:in|from|written\\s+in)\\s+(${LATIN_LANGUAGE_LABEL})\\b(?:[- ](?:${LATIN_MATERIAL_NOUN}))?`,
    "iu",
  );
  const prepositionMatch = prepositionPattern.exec(query);
  if (prepositionMatch && !isNegated(query, prepositionMatch.index)) {
    return {
      language: languageFromLatinLabel(prepositionMatch[1]!),
      matchedPhrase: prepositionMatch[0],
    };
  }

  const explicitFilterPattern = new RegExp(
    `(?:only|just|prefer|prioritize|filter\\s+for)\\s+(${LATIN_LANGUAGE_LABEL})\\b|(?:只看|仅看|只要|仅要|优先(?:显示|看)?|筛选)\\s*(${CJK_LANGUAGE_LABEL})`,
    "iu",
  );
  const filterMatch = explicitFilterPattern.exec(query);
  if (filterMatch && !isNegated(query, filterMatch.index)) {
    const label = filterMatch[1] ?? filterMatch[2];
    return {
      language:
        label && /^(?:Chinese|中文|汉语|華語|华语|简体中文|繁体中文)$/iu.test(label) ? "zh" : "en",
      matchedPhrase: filterMatch[0],
    };
  }
  return null;
}

function languageFromCjkLabel(label: string): RetrievalPreferenceLanguage {
  return /^(?:英文|英语)$/u.test(label) ? "en" : "zh";
}

function languageFromLatinLabel(label: string): RetrievalPreferenceLanguage {
  return /^Chinese/i.test(label) ? "zh" : "en";
}

function isNegated(query: string, matchIndex: number): boolean {
  const prefix = query.slice(Math.max(0, matchIndex - 8), matchIndex);
  return /(?:不是|非|排除|不要|避免|not|without|except)\s*$/iu.test(prefix);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
