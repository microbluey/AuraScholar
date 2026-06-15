// Normalized work metadata — the shape every connector maps into. The ingest
// pipeline merges several of these (Crossref as bibliographic truth, OpenAlex
// for IDs/abstract/OA) into one record.

export interface NormalizedAuthor {
  displayName: string;
  family?: string;
  given?: string;
  orcid?: string;
  position: number;
  isCorresponding?: boolean;
  /** author (default) | editor | translator. */
  role?: "author" | "editor" | "translator";
}

export interface NormalizedWork {
  doi?: string;
  title: string;
  abstract?: string;
  year?: number;
  /** ISO date string when known. */
  publicationDate?: string;
  venueName?: string;
  venueType?: "journal" | "conference" | "repository" | "book";
  type?: string;
  arxivId?: string;
  openalexId?: string;
  s2Id?: string;
  pmid?: string;
  authors: NormalizedAuthor[];
  // Rich bibliographic fields (when the source provides them).
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  placePublished?: string;
  issn?: string;
  isbn?: string;
  language?: string;
  url?: string;
  /** Author/index keywords. */
  keywords?: string[];
  /** Direct link to a legal OA PDF when one is known. */
  oaPdfUrl?: string;
  /** Raw CSL-JSON when the source provides it (Crossref does). */
  cslJson?: Record<string, unknown>;
  /** Which connector produced this record. */
  source: "crossref" | "openalex" | "s2" | "arxiv" | "unpaywall" | "datacite";
}
