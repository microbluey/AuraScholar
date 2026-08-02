import { describe, expect, it } from "vitest";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import {
  canRecoverEvidenceSource,
  evidenceReaderPath,
  sourceStatusLabel,
  toEvidenceSearchFilters,
  type EvidenceInboxFilters,
} from "./model";

function item(overrides: Partial<EvidenceInboxItemDto> = {}): EvidenceInboxItemDto {
  return {
    assetKind: "pdf",
    assetTitle: "Paper.pdf",
    attachmentId: "attachment:a",
    authorNames: ["Ada Lovelace"],
    evidence: {
      anchor: {},
      assetId: "asset:a",
      availabilityStatus: "available",
      canonicalStatus: "active",
      createdAt: 1,
      deletedAt: null,
      evidenceKind: "method",
      id: "evidence:a",
      libraryId: "library:a",
      noteMd: null,
      provenance: {},
      revisionId: "revision:a",
      revisionStatus: "historical",
      sourceContentHash: "hash",
      sourceKind: "document",
      tags: [],
      text: "Quoted evidence",
      title: null,
      updatedAt: 2,
      workId: "work:a",
    },
    mimeType: "application/pdf",
    pageIndex: 2,
    projectMemberships: [],
    revisionNo: 1,
    workTitle: "A paper",
    year: 2024,
    ...overrides,
  };
}

describe("Evidence Inbox model", () => {
  it("maps unavailable filters to a server-side availability query", () => {
    const filters: EvidenceInboxFilters = {
      evidenceKind: "limitation",
      query: "  causal gap  ",
      scope: { kind: "project", projectId: "project:a" },
      source: "unavailable",
    };
    expect(toEvidenceSearchFilters(filters)).toEqual({
      availabilityStatuses: ["missing", "relink-required"],
      evidenceKinds: ["limitation"],
      query: "causal gap",
      scope: { kind: "project", projectId: "project:a" },
    });
  });

  it("opens the exact original attachment and one-based Reader page", () => {
    expect(evidenceReaderPath(item())).toBe(
      "/reader?attachment=attachment%3Aa&evidence=evidence%3Aa&page=3&work=work%3Aa",
    );
  });

  it("never falls back to another revision when the original source is unavailable", () => {
    const unavailable = item({ attachmentId: null });
    unavailable.evidence.availabilityStatus = "relink-required";
    expect(evidenceReaderPath(unavailable)).toBeNull();
    expect(sourceStatusLabel(unavailable)).toBe("需要重新关联");
  });

  it("can open an exact legacy attachment before its availability check runs", () => {
    const unchecked = item();
    unchecked.evidence.availabilityStatus = "unchecked";
    expect(evidenceReaderPath(unchecked)).toContain("attachment=attachment%3Aa");
  });

  it("only offers the P0 source-recovery flow for PDF revisions", () => {
    const missingPdf = item({ attachmentId: null });
    missingPdf.evidence.availabilityStatus = "missing";
    expect(canRecoverEvidenceSource(missingPdf)).toBe(true);
    expect(canRecoverEvidenceSource({ ...missingPdf, mimeType: "text/html" })).toBe(false);
  });
});
