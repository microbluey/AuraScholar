export type { ConnectorContext } from "./client.js";
export type { ConnectorRequestOptions } from "./client.js";
export { ApiError, getJson, getRaw, isAbortError } from "./client.js";
export type { NormalizedWork, NormalizedAuthor, ConnectorSearchFilters } from "./types.js";
export { crossrefByDoi, crossrefSearchByTitle, crossrefRaw } from "./crossref.js";
export type { CrossrefSearchHit } from "./crossref.js";
export {
  openalexByDoi,
  openalexById,
  openalexCitedBy,
  openalexSearchByTitle,
  normalizeOpenAlex,
  decodeInvertedIndex,
} from "./openalex.js";
export type { OpenAlexWork } from "./openalex.js";
export { unpaywallPdf } from "./unpaywall.js";
export type { OaLocation } from "./unpaywall.js";
export { arxivByid, arxivSearchByTitle, parseArxivId, arxivPdfUrl } from "./arxiv.js";
export { s2ByDoi, s2ById, s2SearchByTitle, s2EnrichByDoi, normalizeS2 } from "./semanticscholar.js";
export type { S2Paper, S2Author, S2Enrichment } from "./semanticscholar.js";
