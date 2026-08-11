import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const deletedAt = () => integer("deleted_at");

/** A logical local-first Library and its canonical bibliographic Works. */
export const libraries = sqliteTable("libraries", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("personal"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const works = sqliteTable(
  "works",
  {
    id: id(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    doi: text("doi"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    year: integer("year"),
    publicationDate: text("publication_date"),
    venueName: text("venue_name"),
    venueType: text("venue_type"),
    type: text("type").notNull().default("article"),
    arxivId: text("arxiv_id"),
    openalexId: text("openalex_id"),
    s2Id: text("s2_id"),
    pmid: text("pmid"),
    fingerprint: text("fingerprint"),
    cslJson: text("csl_json", { mode: "json" }),
    volume: text("volume"),
    issue: text("issue"),
    pages: text("pages"),
    numberOfVolumes: text("number_of_volumes"),
    edition: text("edition"),
    section: text("section"),
    publisher: text("publisher"),
    placePublished: text("place_published"),
    seriesTitle: text("series_title"),
    shortTitle: text("short_title"),
    originalTitle: text("original_title"),
    issn: text("issn"),
    isbn: text("isbn"),
    url: text("url"),
    accessedDate: text("accessed_date"),
    language: text("language"),
    callNumber: text("call_number"),
    accessionNumber: text("accession_number"),
    label: text("label"),
    databaseName: text("database_name"),
    keywordsJson: text("keywords_json", { mode: "json" }),
    readingStatus: text("reading_status").notNull().default("unread"),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    notesMd: text("notes_md"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("works_doi_uq").on(table.libraryId, table.doi),
    index("works_fingerprint_idx").on(table.libraryId, table.fingerprint),
    index("works_arxiv_idx").on(table.libraryId, table.arxivId),
    index("works_openalex_idx").on(table.libraryId, table.openalexId),
    index("works_s2_idx").on(table.libraryId, table.s2Id),
    index("works_pmid_idx").on(table.libraryId, table.pmid),
    index("works_year_idx").on(table.libraryId, table.year),
    index("works_page_created_idx").on(table.libraryId, table.deletedAt, table.createdAt, table.id),
    index("works_page_year_idx").on(
      table.libraryId,
      table.deletedAt,
      table.year,
      table.createdAt,
      table.id,
    ),
    index("works_page_deleted_idx").on(table.libraryId, table.deletedAt, table.updatedAt, table.id),
  ],
);
