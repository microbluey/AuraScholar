import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitAiFlashcardGeneration,
  generateAiFlashcards,
  getAiFlashcardTarget,
  recordAiFlashcardFailure,
  testAiProvider,
} from "./ai-data";

const command = vi.fn();

beforeEach(() => {
  command.mockReset();
  vi.stubGlobal("window", { aura: { data: { command } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI command facade", () => {
  it("sends provider runs only opaque request metadata and content, never a configured target", async () => {
    command.mockResolvedValueOnce({ created: 6 }).mockResolvedValueOnce({ text: "ok" });

    await expect(
      generateAiFlashcards({ paperText: "bounded paper text", workId: "work-1" }),
    ).resolves.toEqual({ created: 6 });
    await expect(testAiProvider()).resolves.toEqual({ text: "ok" });

    const [flashcardName, flashcardInput] = command.mock.calls[0] ?? [];
    expect(flashcardName).toBe("ai.generateFlashcards");
    expect(flashcardInput).toEqual({
      paperText: "bounded paper text",
      requestId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
      workId: "work-1",
    });
    expect(Object.keys(flashcardInput as object).sort()).toEqual([
      "paperText",
      "requestId",
      "workId",
    ]);

    const [testName, testInput] = command.mock.calls[1] ?? [];
    expect(testName).toBe("ai.testProvider");
    expect(testInput).toEqual({
      requestId: expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    });
  });

  it("uses only the typed AI command names and narrow inputs", async () => {
    command
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ created: 6 })
      .mockResolvedValueOnce({ recorded: true });
    const result = {
      contributions: ["Contribution"],
      limitations: "Limitations",
      method: "Method",
      problem: "Problem",
      qaCards: [
        { a: "Answer one", q: "Question one" },
        { a: "Answer two", q: "Question two" },
      ],
      results: "Results",
      tldr: "TLDR",
    };

    await expect(getAiFlashcardTarget("work-1")).resolves.toEqual({ active: true });
    await expect(
      commitAiFlashcardGeneration({
        model: "test-model",
        promptVersion: "flashcards-v1",
        result,
        workId: "work-1",
      }),
    ).resolves.toEqual({ created: 6 });
    await expect(
      recordAiFlashcardFailure({ error: "safe error", workId: "work-1" }),
    ).resolves.toEqual({ recorded: true });

    expect(command.mock.calls).toEqual([
      ["ai.getFlashcardTarget", { workId: "work-1" }],
      [
        "ai.commitFlashcardGeneration",
        {
          model: "test-model",
          promptVersion: "flashcards-v1",
          result,
          workId: "work-1",
        },
      ],
      ["ai.recordFlashcardFailure", { error: "safe error", workId: "work-1" }],
    ]);
  });
});
