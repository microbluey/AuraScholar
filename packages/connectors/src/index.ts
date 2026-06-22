export type { ConnectorContext } from "./client";
export type { ConnectorRequestOptions } from "./client";
export { ApiError, getJson, getRaw, isAbortError } from "./client";
export type { NormalizedWork, NormalizedAuthor, ConnectorSearchFilters } from "./types";
export { crossrefByDoi, crossrefSearchByTitle, crossrefRaw } from "./crossref";
export type { CrossrefSearchHit } from "./crossref";
export {
  openalexByDoi,
  openalexById,
  openalexCitedBy,
  openalexSearchByTitle,
  normalizeOpenAlex,
  decodeInvertedIndex,
} from "./openalex";
export type { OpenAlexWork } from "./openalex";
export { unpaywallPdf } from "./unpaywall";
export type { OaLocation } from "./unpaywall";
export { arxivByid, arxivSearchByTitle, parseArxivId, arxivPdfUrl } from "./arxiv";
export { s2ByDoi, s2ById, s2SearchByTitle, s2EnrichByDoi, normalizeS2 } from "./semanticscholar";
export type { S2Paper, S2Author, S2Enrichment } from "./semanticscholar";
