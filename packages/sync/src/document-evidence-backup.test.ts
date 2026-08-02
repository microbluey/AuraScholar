import { describe, expect, it } from "vitest";
import {
  DOCUMENT_EVIDENCE_BACKUP_TABLES,
  assertDocumentEvidenceBackupOrder,
  assertDocumentEvidenceBackupRelationships,
  remapDocumentEvidenceBackupRow,
  type DocumentEvidenceBackupIdMaps,
  type DocumentEvidenceBackupRows,
} from "./document-evidence-backup";

const maps: DocumentEvidenceBackupIdMaps = {
  assets: new Map([["asset-source", "asset-target"]]),
  attachments: new Map([["attachment-source", "attachment-target"]]),
  evidence: new Map([["evidence-source", "evidence-target"]]),
  projectAssets: new Map([["project-asset-source", "project-asset-target"]]),
  projectEvidence: new Map([["project-evidence-source", "project-evidence-target"]]),
  projects: new Map([["project-source", "project-target"]]),
  revisions: new Map([["revision-source", "revision-target"]]),
  works: new Map([["work-source", "work-target"]]),
};

function graph(): DocumentEvidenceBackupRows {
  return {
    works: [{ id: "work-source", library_id: "library-source" }],
    research_projects: [{ id: "project-source", library_id: "library-source" }],
    attachments: [{ id: "attachment-source", work_id: "work-source" }],
    document_assets: [
      {
        id: "asset-source",
        library_id: "library-source",
        work_id: "work-source",
        current_revision_id: "revision-source",
      },
    ],
    document_revisions: [
      {
        id: "revision-source",
        asset_id: "asset-source",
        attachment_id: "attachment-source",
      },
    ],
    project_assets: [
      {
        id: "project-asset-source",
        project_id: "project-source",
        asset_id: "asset-source",
      },
    ],
    evidence_items: [
      {
        id: "evidence-source",
        library_id: "library-source",
        work_id: "work-source",
        asset_id: "asset-source",
        revision_id: "revision-source",
        anchor_json: JSON.stringify({
          version: 1,
          kind: "pdf",
          revisionId: "revision-source",
          pageIndex: 0,
        }),
      },
    ],
    project_evidence: [
      {
        id: "project-evidence-source",
        project_id: "project-source",
        evidence_id: "evidence-source",
      },
    ],
  };
}

describe("Document/Evidence backup order", () => {
  it("accepts the declared parent-first order", () => {
    expect(DOCUMENT_EVIDENCE_BACKUP_TABLES).toEqual([
      "document_assets",
      "document_revisions",
      "project_assets",
      "evidence_items",
      "project_evidence",
    ]);
    expect(() =>
      assertDocumentEvidenceBackupOrder([
        "libraries",
        "works",
        "research_projects",
        "attachments",
        ...DOCUMENT_EVIDENCE_BACKUP_TABLES,
      ]),
    ).not.toThrow();
  });

  it("rejects missing parents and child-first lists", () => {
    expect(() =>
      assertDocumentEvidenceBackupOrder(["works", ...DOCUMENT_EVIDENCE_BACKUP_TABLES]),
    ).toThrow(/missing table research_projects/);
    expect(() =>
      assertDocumentEvidenceBackupOrder([
        "works",
        "research_projects",
        "attachments",
        "document_revisions",
        "document_assets",
        "project_assets",
        "evidence_items",
        "project_evidence",
      ]),
    ).toThrow(/must be ordered/);
  });
});

describe("Document/Evidence backup remapping", () => {
  it("remaps every row namespace and revision-bound anchor", () => {
    expect(
      remapDocumentEvidenceBackupRow(
        "document_assets",
        {
          id: "asset-source",
          work_id: "work-source",
          current_revision_id: "revision-source",
        },
        maps,
      ),
    ).toEqual({
      redirected: true,
      row: {
        id: "asset-target",
        work_id: "work-target",
        current_revision_id: "revision-target",
      },
    });
    expect(
      remapDocumentEvidenceBackupRow(
        "document_revisions",
        {
          id: "revision-source",
          asset_id: "asset-source",
          attachment_id: "attachment-source",
        },
        maps,
      ).row,
    ).toEqual({
      id: "revision-target",
      asset_id: "asset-target",
      attachment_id: "attachment-target",
    });
    expect(
      remapDocumentEvidenceBackupRow(
        "project_assets",
        {
          id: "project-asset-source",
          project_id: "project-source",
          asset_id: "asset-source",
        },
        maps,
      ).row,
    ).toEqual({
      id: "project-asset-target",
      project_id: "project-target",
      asset_id: "asset-target",
    });

    const evidence = remapDocumentEvidenceBackupRow(
      "evidence_items",
      {
        id: "evidence-source",
        work_id: "work-source",
        asset_id: "asset-source",
        revision_id: "revision-source",
        anchor_json: JSON.stringify({
          version: 1,
          kind: "pdf",
          revisionId: "revision-source",
          pageIndex: 3,
          quads: {
            pageIndex: 3,
            rects: [{ x1: 10, y1: 20, x2: 110, y2: 32 }],
          },
          quote: {
            exact: "Grounded evidence",
            prefix: "Before ",
            suffix: " after",
          },
          position: { start: 42, end: 59 },
        }),
      },
      maps,
    );
    expect(evidence.redirected).toBe(true);
    expect(evidence.row).toMatchObject({
      id: "evidence-target",
      work_id: "work-target",
      asset_id: "asset-target",
      revision_id: "revision-target",
    });
    expect(JSON.parse(evidence.row.anchor_json as string)).toEqual({
      version: 1,
      kind: "pdf",
      revisionId: "revision-target",
      pageIndex: 3,
      quads: {
        pageIndex: 3,
        rects: [{ x1: 10, y1: 20, x2: 110, y2: 32 }],
      },
      quote: {
        exact: "Grounded evidence",
        prefix: "Before ",
        suffix: " after",
      },
      position: { start: 42, end: 59 },
    });
    expect(
      remapDocumentEvidenceBackupRow(
        "project_evidence",
        {
          id: "project-evidence-source",
          project_id: "project-source",
          evidence_id: "evidence-source",
        },
        maps,
      ).row,
    ).toEqual({
      id: "project-evidence-target",
      project_id: "project-target",
      evidence_id: "evidence-target",
    });
  });

  it("keeps unchanged rows by identity", () => {
    const row = { id: "asset-local", work_id: null, current_revision_id: null };
    const result = remapDocumentEvidenceBackupRow("document_assets", row, maps);
    expect(result).toEqual({ redirected: false, row });
    expect(result.row).toBe(row);
  });

  it("fails closed for non-revision anchors and mismatched revisions", () => {
    expect(() =>
      remapDocumentEvidenceBackupRow(
        "evidence_items",
        {
          id: "evidence-source",
          revision_id: "revision-source",
          anchor_json: JSON.stringify({
            version: 1,
            kind: "canvas",
            workspaceId: "workspace",
            nodeId: "node",
            nodeRevision: 1,
          }),
        },
        maps,
      ),
    ).toThrow(/not revision-bound/);
    expect(() =>
      remapDocumentEvidenceBackupRow(
        "evidence_items",
        {
          id: "evidence-source",
          revision_id: "revision-source",
          anchor_json: JSON.stringify({
            version: 1,
            kind: "pdf",
            revisionId: "another-revision",
            pageIndex: 0,
          }),
        },
        maps,
      ),
    ).toThrow(/does not match/);
  });

  it.each([
    {
      label: "negative PDF page",
      anchor: {
        version: 1,
        kind: "pdf",
        revisionId: "revision-source",
        pageIndex: -1,
      },
      message: /page index must be a non-negative integer/i,
    },
    {
      label: "inverted text position",
      anchor: {
        version: 1,
        kind: "pdf",
        revisionId: "revision-source",
        pageIndex: 0,
        position: { start: 12, end: 4 },
      },
      message: /must not precede/i,
    },
    {
      label: "PDF quads on another page",
      anchor: {
        version: 1,
        kind: "pdf",
        revisionId: "revision-source",
        pageIndex: 2,
        quads: {
          pageIndex: 3,
          rects: [{ x1: 0, y1: 0, x2: 10, y2: 10 }],
        },
      },
      message: /quad selector/i,
    },
    {
      label: "malformed HTML structure",
      anchor: {
        version: 1,
        kind: "html",
        revisionId: "revision-source",
        headingPath: ["Methods"],
        blockPath: "paragraph-4",
      },
      message: /block path must be a string array/i,
    },
  ])("rejects a structurally invalid $label anchor", ({ anchor, message }) => {
    expect(() =>
      remapDocumentEvidenceBackupRow(
        "evidence_items",
        {
          id: "evidence-source",
          revision_id: "revision-source",
          anchor_json: JSON.stringify(anchor),
        },
        maps,
      ),
    ).toThrow(message);
  });
});

describe("Document/Evidence backup graph validation", () => {
  it("accepts a coherent Library graph", () => {
    expect(() => assertDocumentEvidenceBackupRelationships(graph())).not.toThrow();
  });

  it("rejects cross-asset revisions and dangling relationships", () => {
    const wrongCurrentRevision = graph();
    wrongCurrentRevision.document_assets = [
      ...(wrongCurrentRevision.document_assets ?? []),
      {
        id: "asset-other",
        library_id: "library-source",
        work_id: "work-source",
        current_revision_id: "revision-source",
      },
    ];
    expect(() => assertDocumentEvidenceBackupRelationships(wrongCurrentRevision)).toThrow(
      /belongs to another asset/,
    );

    const danglingEvidence = graph();
    danglingEvidence.project_evidence = [
      {
        id: "project-evidence-source",
        project_id: "project-source",
        evidence_id: "missing-evidence",
      },
    ];
    expect(() => assertDocumentEvidenceBackupRelationships(danglingEvidence)).toThrow(
      /invalid reference: project_evidence.evidence_id/,
    );
  });

  it("rejects cross-Library and duplicate semantic memberships", () => {
    const crossLibrary = graph();
    crossLibrary.research_projects = [{ id: "project-source", library_id: "library-foreign" }];
    expect(() => assertDocumentEvidenceBackupRelationships(crossLibrary)).toThrow(
      /cross-Library reference: project_assets.asset_id/,
    );

    const duplicate = graph();
    duplicate.project_assets = [
      ...(duplicate.project_assets ?? []),
      {
        id: "project-asset-duplicate",
        project_id: "project-source",
        asset_id: "asset-source",
      },
    ];
    expect(() => assertDocumentEvidenceBackupRelationships(duplicate)).toThrow(
      /duplicate semantic membership/,
    );
  });
});
