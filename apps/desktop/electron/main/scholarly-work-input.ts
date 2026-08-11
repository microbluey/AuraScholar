import type { NormalizedWork } from "@aurascholar/connectors";
import type { WorkInput } from "@aurascholar/db/repos/works";

/**
 * Main-only adapter for connector output. Validation stays with the existing
 * Library ingest parser before this object reaches `WorksRepo.upsert`.
 * Keeping the mapping here prevents a main runner from importing renderer
 * service modules merely to reuse a DTO conversion.
 */
export function normalizedWorkToMainWorkInput(work: NormalizedWork): WorkInput {
  return {
    abstract: work.abstract,
    arxivId: work.arxivId,
    authors: work.authors.map((author) => ({
      displayName: author.displayName,
      orcid: author.orcid,
      position: author.position,
      role: author.role,
    })),
    cslJson: work.cslJson,
    doi: work.doi,
    isbn: work.isbn,
    issn: work.issn,
    issue: work.issue,
    keywords: work.keywords,
    language: work.language,
    openalexId: work.openalexId,
    pages: work.pages,
    placePublished: work.placePublished,
    pmid: work.pmid,
    publicationDate: work.publicationDate,
    publisher: work.publisher,
    s2Id: work.s2Id,
    title: work.title,
    type: work.type,
    url: work.url,
    venueName: work.venueName,
    venueType: work.venueType,
    volume: work.volume,
    year: work.year,
  };
}
