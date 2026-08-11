import type {
  AiCommitFlashcardGenerationCommandInput,
  AiCommitFlashcardGenerationCommandResult,
  AiDataCommandInput,
  AiDataCommandOutput,
  AiGenerateFlashcardsCommandInput,
  AiGenerateFlashcardsCommandResult,
  AiGetFlashcardTargetCommandResult,
  AiRecordFlashcardFailureCommandInput,
  AiRecordFlashcardFailureCommandResult,
  AiSynthesizeCanvasCommandInput,
  AiSynthesizeCanvasCommandResult,
  AiTestProviderCommandResult,
} from "../../electron/ai-command-contract";

export function getAiFlashcardTarget(workId: string): Promise<AiGetFlashcardTargetCommandResult> {
  return window.aura.data.command("ai.getFlashcardTarget", { workId });
}

/** Main-owned provider invocation; only bounded paper text crosses IPC. */
export function generateAiFlashcards(
  input: Omit<AiGenerateFlashcardsCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<AiGenerateFlashcardsCommandResult> {
  return invokeCancellableAiRun("ai.generateFlashcards", input, signal);
}

/** Main-owned provider invocation with per-source active Library checks. */
export function synthesizeAiCanvas(
  input: Omit<AiSynthesizeCanvasCommandInput, "requestId">,
  signal?: AbortSignal,
): Promise<AiSynthesizeCanvasCommandResult> {
  return invokeCancellableAiRun("ai.synthesizeCanvas", input, signal);
}

/** Fixed-prompt provider smoke request; config/secret remain in main. */
export function testAiProvider(signal?: AbortSignal): Promise<AiTestProviderCommandResult> {
  return invokeCancellableAiRun("ai.testProvider", {}, signal);
}

export function commitAiFlashcardGeneration(
  input: AiCommitFlashcardGenerationCommandInput,
): Promise<AiCommitFlashcardGenerationCommandResult> {
  return window.aura.data.command("ai.commitFlashcardGeneration", input);
}

export function recordAiFlashcardFailure(
  input: AiRecordFlashcardFailureCommandInput,
): Promise<AiRecordFlashcardFailureCommandResult> {
  return window.aura.data.command("ai.recordFlashcardFailure", input);
}

type CancellableAiRunName = "ai.generateFlashcards" | "ai.synthesizeCanvas" | "ai.testProvider";

type CancellableAiRunInput<K extends CancellableAiRunName> = Omit<
  AiDataCommandInput<K>,
  "requestId"
>;

async function invokeCancellableAiRun<K extends CancellableAiRunName>(
  name: K,
  input: CancellableAiRunInput<K>,
  signal?: AbortSignal,
): Promise<AiDataCommandOutput<K>> {
  if (signal?.aborted) throw abortError();
  const requestId = newAiRunRequestId();
  let cancellationRequested = false;
  const cancel = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    // Cancellation is intentionally fire-and-forget: the original request is
    // still the source of the user-visible result/error and may already have
    // crossed its short durable commit boundary.
    void window.aura.data.command("ai.cancelRun", { requestId }).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await window.aura.data.command(name, {
      ...input,
      requestId,
    } as AiDataCommandInput<K>);
    if (signal?.aborted) throw abortError();
    return result as AiDataCommandOutput<K>;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

function newAiRunRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function abortError(): Error {
  const error = new Error("AI request cancelled");
  error.name = "AbortError";
  return error;
}
