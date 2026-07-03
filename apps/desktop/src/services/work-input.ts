import type { WorkInput } from "@aurascholar/db";
import type { NormalizedWork } from "@aurascholar/connectors";

export function toWorkInput(w: NormalizedWork): WorkInput {
  return {
    doi: w.doi,
    title: w.title,
    abstract: w.abstract,
    year: w.year,
    publicationDate: w.publicationDate,
    venueName: w.venueName,
    venueType: w.venueType,
    type: w.type,
    arxivId: w.arxivId,
    openalexId: w.openalexId,
    s2Id: w.s2Id,
    pmid: w.pmid,
    volume: w.volume,
    issue: w.issue,
    pages: w.pages,
    publisher: w.publisher,
    placePublished: w.placePublished,
    issn: w.issn,
    isbn: w.isbn,
    language: w.language,
    url: w.url,
    keywords: w.keywords,
    cslJson: w.cslJson,
    authors: w.authors.map((a) => ({
      displayName: a.displayName,
      orcid: a.orcid,
      position: a.position,
      role: a.role,
    })),
  };
}
