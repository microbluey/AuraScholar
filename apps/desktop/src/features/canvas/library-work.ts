import type {
  CanvasActiveWork,
} from "../../../electron/data-command-contract";
import type {
  LibraryListWork,
  LibraryMetadataSearchWork,
} from "../../services/library-list";
import type { CanvasLibraryWork } from "./model";

type CanvasLibraryListWork = LibraryListWork | LibraryMetadataSearchWork;
type CanvasLibraryWorkSource = CanvasLibraryListWork | CanvasActiveWork;

function isLibraryListWork(row: CanvasLibraryWorkSource): row is CanvasLibraryListWork {
  return "createdAt" in row;
}

function listTags(row: CanvasLibraryListWork): string[] {
  return "tagNames" in row ? row.tagNames : [];
}

/** Adapts lightweight Library lists and narrow Canvas ingress DTOs. */
export function toCanvasLibraryWork(row: CanvasLibraryWorkSource): CanvasLibraryWork {
  if (isLibraryListWork(row)) {
    return {
      abstract: row.abstract,
      authorNames: row.authorNames,
      doi: row.doi,
      id: row.id,
      readingStatus: row.readingStatus,
      tags: listTags(row),
      title: row.title,
      venue: row.venueName,
      year: row.year,
    };
  }

  return {
    abstract: row.abstract,
    authorNames: row.authorNames,
    doi: row.doi,
    id: row.id,
    readingStatus: row.reading_status,
    tags: [],
    title: row.title,
    venue: row.venue_name,
    year: row.year,
  };
}
