import type { WorkWithAuthors } from "@aurascholar/db";
import type { LibraryListWork } from "../../services/library-list";
import type { CanvasLibraryWork } from "./model";

type CanvasLibraryWorkSource = LibraryListWork | (WorkWithAuthors & { tagNames?: string[] });

/** Adapts both lightweight list DTOs and scoped Canvas ingress rows. */
export function toCanvasLibraryWork(row: CanvasLibraryWorkSource): CanvasLibraryWork {
  const isListDto = "createdAt" in row;
  const tagNames = "tagNames" in row ? row.tagNames : [];
  return {
    abstract: row.abstract,
    authorNames: row.authorNames,
    doi: row.doi,
    id: row.id,
    readingStatus: isListDto ? row.readingStatus : row.reading_status,
    tags: tagNames ?? [],
    title: row.title,
    venue: isListDto ? row.venueName : row.venue_name,
    year: row.year,
  };
}
