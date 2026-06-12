export type { ConnectorContext } from "./client";
export { ApiError, getJson, getRaw } from "./client";
export type { NormalizedWork, NormalizedAuthor } from "./types";
export { crossrefByDoi, crossrefSearchByTitle, crossrefRaw } from "./crossref";
export type { CrossrefSearchHit } from "./crossref";
export {
  openalexByDoi,
  openalexById,
  openalexCitedBy,
  normalizeOpenAlex,
  decodeInvertedIndex,
} from "./openalex";
export type { OpenAlexWork } from "./openalex";
export { unpaywallPdf } from "./unpaywall";
export type { OaLocation } from "./unpaywall";
export { arxivByid, parseArxivId, arxivPdfUrl } from "./arxiv";
