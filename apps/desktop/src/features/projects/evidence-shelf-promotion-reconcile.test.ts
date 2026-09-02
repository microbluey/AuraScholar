import { describe, expect, it, vi } from "vitest";
import { toPreviewPayload } from "../../services/evidence-shelf";
import type { KnowledgeContentSearchResult } from "../../../electron/data-command-contract";
import type { EvidenceShelfItem } from "../../services/evidence-shelf";
import {
  isEvidenceShelfPromotionReconcileCurrent,
  reconcileEvidenceShelfPromotionAfterAbort,
  reconcileEvidenceShelfPromotion,
} from "./evidence-shelf-promotion-reconcile";

const candidate: KnowledgeContentSearchResult = {
  anchor: { kind: "pdf", pageIndex: 0, revisionId: "revision:1", version: 1 },
  assetId: "asset:1",
  excerpt: "A quote",
  headingPath: [],
  id: "unit:1",
  language: "en",
  ordinal: 0,
  parentUnitId: null,
  revisionId: "revision:1",
  score: 1,
  sourceId: "revision:1",
  sourceType: "pdf",
  state: "ready",
  text: "A quote",
  tokenCount: 2,
  workId: "work:1",
  workTitle: "Work",
};

function item(id: string): EvidenceShelfItem {
  return {
    anchorSnapshot: candidate.anchor,
    assetId: candidate.assetId,
    createdAt: 1,
    currentRevisionId: candidate.revisionId,
    currentSourceContentHash: "a".repeat(64),
    deletedAt: null,
    id,
    isStale: false,
    libraryId: "library:1",
    previewPayload: toPreviewPayload(candidate),
    projectId: "project:1",
    revisionId: candidate.revisionId,
    sourceContentHash: "a".repeat(64),
    status: "staged",
    updatedAt: 1,
    workId: candidate.workId,
  };
}

function requestFixture() {
  const service = {};
  const scope = { enabled: true, generation: 4, projectId: "project:1", refreshToken: 2, service };
  let current = { ...scope };
  const updateItems = () => undefined;
  const setSelection = () => undefined;
  const setError = () => undefined;
  const setNotice = () => undefined;
  return {
    service,
    scope,
    getCurrent: () => current,
    invalidate: () => {
      current = { ...current, generation: current.generation + 1 };
    },
    updateItems,
    setSelection,
    setError,
    setNotice,
  };
}

describe("reconcileEvidenceShelfPromotion", () => {
  it("returns the fresh row when a cancelled promotion did not commit", () => {
    const result = reconcileEvidenceShelfPromotion([item("shelf:1")], "shelf:1");
    expect(result.items).toHaveLength(1);
    expect(result.selection?.id).toBe("shelf:1");
  });

  it("returns no selection when the durable promotion consumed the Shelf row", () => {
    const result = reconcileEvidenceShelfPromotion([], "shelf:1");
    expect(result.items).toEqual([]);
    expect(result.selection).toBeNull();
  });

  it("rejects late results from another action or project scope", () => {
    const service = {};
    const expected = {
      enabled: true,
      generation: 4,
      projectId: "project:1",
      refreshToken: 2,
      service,
    };
    expect(isEvidenceShelfPromotionReconcileCurrent(expected, { ...expected })).toBe(true);
    expect(
      isEvidenceShelfPromotionReconcileCurrent(expected, {
        ...expected,
        generation: 5,
      }),
    ).toBe(false);
    expect(
      isEvidenceShelfPromotionReconcileCurrent(expected, {
        ...expected,
        projectId: "project:2",
      }),
    ).toBe(false);
  });

  it("drops a list result when scope changes while the fresh read is pending", async () => {
    const fixture = requestFixture();
    let resolveList!: (items: EvidenceShelfItem[]) => void;
    const list = () => new Promise<EvidenceShelfItem[]>((resolve) => (resolveList = resolve));
    const updateItems = vi.fn();
    const pending = reconcileEvidenceShelfPromotionAfterAbort({
      expectedScope: fixture.scope,
      currentScope: fixture.getCurrent,
      itemId: "shelf:1",
      list,
      selectionScope: fixture.scope,
      setError: fixture.setError,
      setNotice: fixture.setNotice,
      setSelection: fixture.setSelection,
      updateItems,
    });
    fixture.invalidate();
    resolveList([item("shelf:1")]);
    await pending;
    expect(updateItems).not.toHaveBeenCalled();
  });

  it("fails closed when the reconciliation list fails", async () => {
    const fixture = requestFixture();
    const updateItems = vi.fn();
    const setSelection = vi.fn();
    const setError = vi.fn();
    await reconcileEvidenceShelfPromotionAfterAbort({
      expectedScope: fixture.scope,
      currentScope: fixture.getCurrent,
      itemId: "shelf:1",
      list: async () => {
        throw new Error("offline");
      },
      selectionScope: fixture.scope,
      setError,
      setNotice: fixture.setNotice,
      setSelection,
      updateItems,
    });
    expect(updateItems).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith("Evidence 保存结果待确认，请刷新 Shelf 后重试");
  });

  it("checks scope before each state setter", async () => {
    const fixture = requestFixture();
    const setSelection = vi.fn();
    const setNotice = vi.fn();
    await reconcileEvidenceShelfPromotionAfterAbort({
      expectedScope: fixture.scope,
      currentScope: fixture.getCurrent,
      itemId: "shelf:1",
      list: async () => [item("shelf:1")],
      selectionScope: fixture.scope,
      setError: fixture.setError,
      setNotice,
      setSelection,
      updateItems: () => fixture.invalidate(),
    });
    expect(setSelection).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();

    const next = requestFixture();
    const noticeAfterSelection = vi.fn();
    await reconcileEvidenceShelfPromotionAfterAbort({
      expectedScope: next.scope,
      currentScope: next.getCurrent,
      itemId: "shelf:1",
      list: async () => [],
      selectionScope: next.scope,
      setError: next.setError,
      setNotice: noticeAfterSelection,
      setSelection: () => next.invalidate(),
      updateItems: next.updateItems,
    });
    expect(noticeAfterSelection).not.toHaveBeenCalled();
  });

  it("guards the deferred selection updater against a later scope change", async () => {
    const fixture = requestFixture();
    type Selection = {
      item: EvidenceShelfItem;
      projectId: string;
      refreshToken: string | number;
      service: typeof fixture.service;
    };
    let updateSelection!: (current: Selection | null) => Selection | null;
    await reconcileEvidenceShelfPromotionAfterAbort({
      expectedScope: fixture.scope,
      currentScope: fixture.getCurrent,
      itemId: "shelf:1",
      list: async () => [],
      selectionScope: fixture.scope,
      setError: fixture.setError,
      setNotice: fixture.setNotice,
      setSelection: (updater) => {
        updateSelection = updater;
      },
      updateItems: fixture.updateItems,
    });
    const current: Selection = {
      item: item("shelf:1"),
      projectId: fixture.scope.projectId,
      refreshToken: fixture.scope.refreshToken,
      service: fixture.service,
    };
    fixture.invalidate();
    expect(updateSelection(current)).toBe(current);
  });
});
