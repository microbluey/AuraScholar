import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  describeSafeError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  dispatchEvent: vi.fn(),
  extractFullText: vi.fn(),
  generateAiFlashcards: vi.fn(),
  getAiFlashcardTarget: vi.fn(),
  loadPdfForWork: vi.fn(),
  pdfDestroy: vi.fn(),
  pdfLoad: vi.fn(),
  recordAiFlashcardFailure: vi.fn(),
  toSafeError: vi.fn((error: unknown) => error),
}));

vi.mock("@aurascholar/reader", () => ({
  PdfDocument: { load: mocks.pdfLoad },
  extractFullText: mocks.extractFullText,
}));

vi.mock("./ai-data", () => ({
  generateAiFlashcards: mocks.generateAiFlashcards,
  getAiFlashcardTarget: mocks.getAiFlashcardTarget,
  recordAiFlashcardFailure: mocks.recordAiFlashcardFailure,
  testAiProvider: vi.fn(),
}));

vi.mock("./library-read", () => ({ loadPdfForWork: mocks.loadPdfForWork }));

vi.mock("./sensitive-text", () => ({
  describeSafeError: mocks.describeSafeError,
  toSafeError: mocks.toSafeError,
}));

vi.mock("../storage", () => ({
  isStorageRecord: (value: unknown) => typeof value === "object" && value !== null,
  readLocalStorageJson: vi.fn(),
  tryRemoveLocalStorageItem: vi.fn(),
}));

import { generateFlashcardsForWork } from "./ai";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { dispatchEvent: mocks.dispatchEvent });
  mocks.getAiFlashcardTarget.mockResolvedValue({ active: true });
  mocks.loadPdfForWork.mockResolvedValue({
    attachmentId: "attachment-1",
    data: new Uint8Array([1]),
  });
  mocks.pdfLoad.mockResolvedValue({ destroy: mocks.pdfDestroy });
  mocks.extractFullText.mockResolvedValue("x".repeat(300));
  mocks.generateAiFlashcards.mockResolvedValue({ created: 6 });
  mocks.recordAiFlashcardFailure.mockResolvedValue({ recorded: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI flashcard generation", () => {
  it("keeps PDF extraction in the renderer but delegates provider work and commit to main", async () => {
    const controller = new AbortController();

    await expect(
      generateFlashcardsForWork("work-1", "Renderer-supplied title is ignored", {
        signal: controller.signal,
      }),
    ).resolves.toEqual({ created: 6 });

    expect(mocks.getAiFlashcardTarget).toHaveBeenCalledWith("work-1");
    expect(mocks.loadPdfForWork).toHaveBeenCalledWith("work-1");
    expect(mocks.generateAiFlashcards).toHaveBeenCalledWith(
      { paperText: "x".repeat(300), workId: "work-1" },
      controller.signal,
    );
    expect(mocks.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(mocks.recordAiFlashcardFailure).not.toHaveBeenCalled();
  });

  it("preserves the inactive-work failure and does not extract or send PDF text", async () => {
    mocks.getAiFlashcardTarget.mockResolvedValue({ active: false });
    mocks.recordAiFlashcardFailure.mockResolvedValue({ recorded: false });

    await expect(generateFlashcardsForWork("work-removed", "Removed paper")).rejects.toThrow(
      "文献不存在或已在回收站，无法生成闪卡",
    );

    expect(mocks.loadPdfForWork).not.toHaveBeenCalled();
    expect(mocks.generateAiFlashcards).not.toHaveBeenCalled();
    expect(mocks.recordAiFlashcardFailure).toHaveBeenCalledWith({
      error: "文献不存在或已在回收站，无法生成闪卡",
      workId: "work-removed",
    });
  });

  it("does not record an error job for a cancelled main-provider run", async () => {
    const abort = new Error("AI request cancelled");
    abort.name = "AbortError";
    mocks.generateAiFlashcards.mockRejectedValue(abort);

    await expect(generateFlashcardsForWork("work-1", "Paper title")).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(mocks.recordAiFlashcardFailure).not.toHaveBeenCalled();
  });
});
