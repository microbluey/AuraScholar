import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContentSearchResult } from "../../electron/data-command-contract";
import { getActiveLibraryCommandScope } from "./library-command-scope";
import {
  createDesktopEvidenceShelfService,
  evidenceShelfPreviewHasRedaction,
  evidenceShelfSourceIdentityKey,
  evidenceShelfSourceKey,
  knowledgeResultFromEvidenceShelfItem,
  previewEvidenceShelfService,
  toPreviewPayload,
  type EvidenceShelfPromotionDraft,
  type EvidenceShelfItem,
} from "./evidence-shelf";

vi.mock("./library-command-scope", () => ({ getActiveLibraryCommandScope: vi.fn() }));

const HASH = "a".repeat(64);

function result(
  overrides: Partial<KnowledgeContentSearchResult> = {},
): KnowledgeContentSearchResult {
  return {
    anchor: { kind: "pdf", pageIndex: 4, revisionId: "revision:shelf", version: 1 },
    assetId: "asset:shelf",
    excerpt: "A staged result keeps its exact revision and page context.",
    headingPath: ["Methods", "Sampling"],
    id: "content-unit:shelf",
    language: "en",
    ordinal: 2,
    parentUnitId: null,
    revisionId: "revision:shelf",
    score: 0.8,
    sourceId: "revision:shelf",
    sourceType: "pdf",
    state: "ready",
    text: "A staged result keeps its exact revision and page context.",
    tokenCount: 10,
    workId: "work:shelf",
    workTitle: "Shelf source",
    ...overrides,
  };
}

function item(overrides: Partial<EvidenceShelfItem> = {}): EvidenceShelfItem {
  const candidate = result();
  return {
    anchorSnapshot: candidate.anchor,
    assetId: candidate.assetId,
    createdAt: 1,
    currentRevisionId: candidate.revisionId,
    currentSourceContentHash: HASH,
    deletedAt: null,
    id: "shelf:item",
    isStale: false,
    libraryId: "library:shelf",
    previewPayload: toPreviewPayload(candidate),
    projectId: "project:shelf",
    revisionId: candidate.revisionId,
    sourceContentHash: HASH,
    status: "staged",
    updatedAt: 1,
    workId: candidate.workId,
    ...overrides,
  };
}

describe("Evidence Shelf renderer gateway", () => {
  const command = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { aura: { data: { command } } },
    });
    vi.mocked(getActiveLibraryCommandScope).mockResolvedValue("library:shelf");
  });

  it("uses the active Library scope and sends a canonical ContentUnit stage payload", async () => {
    const staged = { created: true, item: item() };
    command.mockResolvedValue(staged);

    await expect(
      createDesktopEvidenceShelfService().stage("project:shelf", result()),
    ).resolves.toEqual(staged);

    expect(command).toHaveBeenCalledWith("evidenceShelf.stage", {
      anchorSnapshot: result().anchor,
      contentUnitId: result().id,
      libraryId: "library:shelf",
      previewPayload: toPreviewPayload(result()),
      projectId: "project:shelf",
    });
    expect(command.mock.calls[0]?.[1]).not.toHaveProperty("contentHash");
  });

  it("keeps list/remove/clear/resolve calls project-local and typed", async () => {
    command
      .mockResolvedValueOnce({ items: [item()] })
      .mockResolvedValueOnce({ removed: true })
      .mockResolvedValueOnce({ removed: 1 })
      .mockResolvedValueOnce({ item: item(), stale: false });
    const service = createDesktopEvidenceShelfService();

    await expect(service.list("project:shelf")).resolves.toEqual([item()]);
    await expect(service.remove("project:shelf", "shelf:item", 1)).resolves.toBe(true);
    await expect(service.clear("project:shelf")).resolves.toBe(1);
    await expect(service.resolveForSave("project:shelf", item())).resolves.toMatchObject({
      stale: false,
    });

    expect(command.mock.calls.map(([name]) => name)).toEqual([
      "evidenceShelf.list",
      "evidenceShelf.remove",
      "evidenceShelf.clear",
      "evidenceShelf.resolveForSave",
    ]);
    expect(command).toHaveBeenNthCalledWith(1, "evidenceShelf.list", {
      libraryId: "library:shelf",
      projectId: "project:shelf",
    });
    expect(command).toHaveBeenNthCalledWith(2, "evidenceShelf.remove", {
      expectedUpdatedAt: 1,
      itemId: "shelf:item",
      libraryId: "library:shelf",
      projectId: "project:shelf",
    });
    expect(command).toHaveBeenNthCalledWith(4, "evidenceShelf.resolveForSave", {
      expectedRevisionId: "revision:shelf",
      expectedSourceContentHash: HASH,
      itemId: "shelf:item",
      libraryId: "library:shelf",
      projectId: "project:shelf",
    });
  });

  it("maps a promotion draft to the project-local command with an optimistic CAS version", async () => {
    const promoted = {
      created: true,
      evidence: { id: "evidence:shelf", libraryId: "library:shelf" },
      projectMembershipAdded: true,
      removedFromShelf: true,
    };
    command.mockResolvedValue(promoted);
    const draft: EvidenceShelfPromotionDraft = {
      evidenceKind: "method",
      noteMd: "核验后保留这条方法证据",
      tags: ["方法", "核验"],
      title: "实验方法",
    };

    await expect(
      createDesktopEvidenceShelfService().promote("project:shelf", item(), draft),
    ).resolves.toEqual(promoted);

    expect(command).toHaveBeenCalledWith("evidenceShelf.promote", {
      expectedUpdatedAt: 1,
      evidenceKind: "method",
      itemId: "shelf:item",
      libraryId: "library:shelf",
      noteMd: "核验后保留这条方法证据",
      projectId: "project:shelf",
      tags: ["方法", "核验"],
      title: "实验方法",
    });
  });

  it("fails closed in browser preview and never calls the IPC bridge", async () => {
    const candidate = result();
    await expect(previewEvidenceShelfService.list("project:shelf")).resolves.toEqual([]);
    await expect(
      previewEvidenceShelfService.resolveForSave("project:shelf", item()),
    ).resolves.toEqual({
      item: null,
      stale: true,
    });
    await expect(previewEvidenceShelfService.stage("project:shelf", candidate)).rejects.toThrow(
      "仅在桌面应用中可保存",
    );
    await expect(previewEvidenceShelfService.clear("project:shelf")).rejects.toThrow(
      "仅在桌面应用中可保存",
    );
    await expect(
      previewEvidenceShelfService.promote("project:shelf", item(), { evidenceKind: "context" }),
    ).rejects.toThrow("仅在桌面应用中可保存");
    expect(command).not.toHaveBeenCalled();
  });

  it("does not cross a scope boundary after cancellation, including a late IPC response", async () => {
    const beforeScope = new AbortController();
    beforeScope.abort();
    await expect(
      createDesktopEvidenceShelfService().list("project:shelf", { signal: beforeScope.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getActiveLibraryCommandScope).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    const afterScope = new AbortController();
    vi.mocked(getActiveLibraryCommandScope).mockImplementationOnce(async () => {
      afterScope.abort();
      return "library:shelf";
    });
    await expect(
      createDesktopEvidenceShelfService().list("project:shelf", { signal: afterScope.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(command).not.toHaveBeenCalled();

    let resolveCommand!: (value: { items: EvidenceShelfItem[] }) => void;
    command.mockReturnValueOnce(
      new Promise<{ items: EvidenceShelfItem[] }>((resolve) => {
        resolveCommand = resolve;
      }),
    );
    const late = new AbortController();
    const pending = createDesktopEvidenceShelfService().list("project:shelf", {
      signal: late.signal,
    });
    late.abort();
    resolveCommand({ items: [item()] });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("drops a late promotion response after its action is cancelled", async () => {
    let resolveCommand!: (value: {
      created: boolean;
      evidence: { id: string; libraryId: string };
      projectMembershipAdded: boolean;
      removedFromShelf: true;
    }) => void;
    command.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
    );
    const controller = new AbortController();
    const pending = createDesktopEvidenceShelfService().promote(
      "project:shelf",
      item(),
      { evidenceKind: "context" },
      { signal: controller.signal },
    );
    controller.abort();
    resolveCommand({
      created: true,
      evidence: { id: "evidence:shelf", libraryId: "library:shelf" },
      projectMembershipAdded: true,
      removedFromShelf: true,
    });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rehydrates only complete previews while preserving the exact anchor", () => {
    const candidate = result();
    expect(knowledgeResultFromEvidenceShelfItem(item())).toMatchObject({
      anchor: candidate.anchor,
      id: candidate.id,
      revisionId: candidate.revisionId,
      sourceId: candidate.sourceId,
      text: candidate.text,
    });
    expect(
      knowledgeResultFromEvidenceShelfItem(
        item({ previewPayload: { ...toPreviewPayload(candidate), text: "" } }),
      ),
    ).toBeNull();
  });

  it("matches regenerated ContentUnit ids by immutable source identity", () => {
    const imported = result({ id: "content-unit:regenerated" });
    const original = result({ id: "content-unit:before-backup" });

    expect(evidenceShelfSourceIdentityKey(imported)).toBe(evidenceShelfSourceIdentityKey(original));
    expect(evidenceShelfSourceKey(imported)).toBe(evidenceShelfSourceKey(original));
    expect(
      evidenceShelfSourceKey(result({ text: "The same page now has different content." })),
    ).not.toBe(evidenceShelfSourceKey(original));
  });

  it("only enables the identity fallback for explicitly redacted previews", () => {
    expect(evidenceShelfPreviewHasRedaction(item())).toBe(false);
    expect(
      evidenceShelfPreviewHasRedaction(
        item({
          previewPayload: {
            ...toPreviewPayload(result()),
            excerpt: "A credential was [redacted] during backup export.",
            text: "A credential was [redacted] during backup export.",
          },
        }),
      ),
    ).toBe(true);
    expect(
      evidenceShelfPreviewHasRedaction(
        item({
          isStale: true,
          status: "stale",
          previewPayload: {
            ...toPreviewPayload(result()),
            text: "A credential was [redacted] during backup export.",
          },
        }),
      ),
    ).toBe(false);
  });
});
