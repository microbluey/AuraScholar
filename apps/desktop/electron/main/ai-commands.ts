import { Buffer } from "node:buffer";
import {
  flashcardsToCards,
  generateCanvasSynthesis,
  generateFlashcards,
  PROMPT_VERSION,
  type AIProvider,
  type CanvasSynthesisSource,
} from "@aurascholar/ai";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { newId } from "@aurascholar/db/ids";
import { FlashcardsRepo } from "@aurascholar/db/repos/flashcards";
import { toSafeError } from "@aurascholar/platform";
import type {
  AiCanvasSynthesisSource,
  AiCommitFlashcardGenerationCommandInput,
  AiDataCommandName,
  AiGenerateFlashcardsCommandInput,
  AiSynthesizeCanvasCommandInput,
  AiTestProviderCommandInput,
} from "../ai-command-contract";
import type { DataCommandOutput, DataCommandRequest } from "../data-command-contract";
import {
  parseAdoptLegacyAiSettingsInput,
  parseCancelAiRunInput,
  parseCommitFlashcardGenerationInput,
  parseEmptyAiInput,
  parseGenerateFlashcardsInput,
  parseGetFlashcardTargetInput,
  parseRecordFlashcardFailureInput,
  parseSaveAiSettingsInput,
  parseSynthesizeCanvasInput,
  parseTestAiProviderInput,
} from "./ai-command-input";
import { createConfiguredAiProvider } from "./ai-provider";
import { mainAiRunRegistry, type MainAiRunRegistry } from "./ai-run-registry";
import { mainAiSettingsStore, type MainAiSettingsStore } from "./ai-settings-store";
import { assertActiveLocalLibrary, type DataCommandDependencies } from "./data-command-runtime";

const MAX_AI_CANVAS_OUTPUT_BYTES = 1024 * 1024;
const MAX_AI_TEST_RESPONSE_BYTES = 4 * 1024;

export type AiCommandRequest = Extract<DataCommandRequest, { name: AiDataCommandName }>;

/**
 * The dispatcher adapts its coordinator-backed execute lease to this narrow
 * dependency, without giving the handler raw IPC access.
 */
export interface AiCommandDependencies extends Pick<DataCommandDependencies, "execute"> {
  providerFactory?: () => Promise<AIProvider>;
  runs?: Pick<MainAiRunRegistry, "begin" | "cancel" | "end">;
  settings?: Pick<MainAiSettingsStore, "adoptLegacy" | "getSnapshot" | "save">;
}

/**
 * Main-owned persistence for the renderer's provider/PDF pipeline. Every
 * branch derives the durable local Library inside its coordinator lease.
 */
export async function executeAiCommand(
  request: AiCommandRequest,
  dependencies: AiCommandDependencies,
): Promise<DataCommandOutput<AiDataCommandName>> {
  switch (request.name) {
    case "ai.adoptLegacySettings": {
      const input = parseAdoptLegacyAiSettingsInput(request.input);
      return aiSettings(dependencies).adoptLegacy(input);
    }
    case "ai.cancelRun": {
      const input = parseCancelAiRunInput(request.input);
      return { cancelled: aiRuns(dependencies).cancel(input.requestId) };
    }
    case "ai.getFlashcardTarget": {
      const input = parseGetFlashcardTargetInput(request.input);
      return executeAiLease(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        return { active: (await findActiveWorkTitle(database, libraryId, input.workId)) !== null };
      });
    }
    case "ai.generateFlashcards": {
      const input = parseGenerateFlashcardsInput(request.input);
      return generateFlashcardsInMain(input, dependencies);
    }
    case "ai.getSettings": {
      parseEmptyAiInput(request.input, "ai.getSettings");
      return aiSettings(dependencies).getSnapshot();
    }
    case "ai.commitFlashcardGeneration": {
      const input = parseCommitFlashcardGenerationInput(request.input);
      return executeAiLease(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        const title = await findActiveWorkTitle(database, libraryId, input.workId);
        if (title === null) {
          throw new Error("Work is missing, removed, or outside the active Library");
        }
        return commitFlashcardGeneration(database, libraryId, input, title);
      });
    }
    case "ai.recordFlashcardFailure": {
      const input = parseRecordFlashcardFailureInput(request.input);
      return executeAiLease(dependencies, request.name, async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        if ((await findActiveWorkTitle(database, libraryId, input.workId)) === null) {
          return { recorded: false };
        }
        const now = Date.now();
        await database.run(
          `INSERT INTO ai_jobs
             (id, library_id, kind, work_id, status, error, created_at, updated_at)
           VALUES (?, ?, 'flashcards', ?, 'error', ?, ?, ?)`,
          [newId(), libraryId, input.workId, input.error, now, now],
        );
        return { recorded: true };
      });
    }
    case "ai.saveSettings": {
      const input = parseSaveAiSettingsInput(request.input);
      return aiSettings(dependencies).save(input);
    }
    case "ai.synthesizeCanvas": {
      const input = parseSynthesizeCanvasInput(request.input);
      return synthesizeCanvasInMain(input, dependencies);
    }
    case "ai.testProvider": {
      const input = parseTestAiProviderInput(request.input);
      return testProviderInMain(input, dependencies);
    }
  }
}

function aiSettings(
  dependencies: AiCommandDependencies,
): Pick<MainAiSettingsStore, "adoptLegacy" | "getSnapshot" | "save"> {
  return dependencies.settings ?? mainAiSettingsStore;
}

function aiRuns(
  dependencies: AiCommandDependencies,
): Pick<MainAiRunRegistry, "begin" | "cancel" | "end"> {
  return dependencies.runs ?? mainAiRunRegistry;
}

function executeAiLease<K extends AiDataCommandName>(
  dependencies: AiCommandDependencies,
  commandName: K,
  operation: (database: Database) => DataCommandOutput<K> | Promise<DataCommandOutput<K>>,
): Promise<DataCommandOutput<K>> {
  if (!dependencies.execute) throw new Error("Main-process AI command execution is unavailable");
  return dependencies.execute(commandName, operation);
}

async function generateFlashcardsInMain(
  input: AiGenerateFlashcardsCommandInput,
  dependencies: AiCommandDependencies,
): Promise<{ created: number }> {
  return withAiRun(input.requestId, dependencies, async (signal) => {
    const title = await executeAiInternalLease(
      dependencies,
      "ai.generateFlashcards",
      async (database) => {
        const libraryId = await requireActiveLocalLibraryId(database);
        const activeTitle = await findActiveWorkTitle(database, libraryId, input.workId);
        if (activeTitle === null) {
          throw new Error("文献不存在或已在回收站，无法生成闪卡");
        }
        return activeTitle;
      },
    );
    assertAiRunNotAborted(signal);
    const provider = await createAiProvider(dependencies);
    const result = await generateFlashcards(provider, {
      language: "zh",
      paperText: input.paperText,
      signal,
      title,
    });
    assertAiRunNotAborted(signal);

    // Re-derive the target at the commit boundary. A work can be trashed or
    // moved after text extraction/provider completion; no stale result may
    // write across the active Library boundary.
    return executeAiInternalLease(dependencies, "ai.generateFlashcards", async (database) => {
      const libraryId = await requireActiveLocalLibraryId(database);
      const activeTitle = await findActiveWorkTitle(database, libraryId, input.workId);
      if (activeTitle === null) {
        throw new Error("Work is missing, removed, or outside the active Library");
      }
      assertAiRunNotAborted(signal);
      return commitFlashcardGeneration(
        database,
        libraryId,
        {
          model: provider.model,
          promptVersion: PROMPT_VERSION,
          result,
          workId: input.workId,
        },
        activeTitle,
      );
    });
  });
}

async function synthesizeCanvasInMain(
  input: AiSynthesizeCanvasCommandInput,
  dependencies: AiCommandDependencies,
): Promise<DataCommandOutput<"ai.synthesizeCanvas">> {
  return withAiRun(input.requestId, dependencies, async (signal) => {
    await executeAiInternalLease(dependencies, "ai.synthesizeCanvas", async (database) => {
      const libraryId = await requireActiveLocalLibraryId(database);
      await assertCanvasSourcesInActiveLibrary(database, libraryId, input.sources);
      return undefined;
    });
    assertAiRunNotAborted(signal);
    const provider = await createAiProvider(dependencies);
    const output = await generateCanvasSynthesis(provider, {
      language: "zh",
      mode: input.mode,
      signal,
      sources: input.sources.map(toProviderCanvasSource),
    });
    assertAiRunNotAborted(signal);
    assertBoundedCanvasSynthesisOutput(output);
    return {
      contentMarkdown: output.contentMarkdown,
      modelName: provider.model,
      ...(output.structuredTable ? { structuredTable: output.structuredTable } : {}),
      title: output.title,
    };
  });
}

async function testProviderInMain(
  input: AiTestProviderCommandInput,
  dependencies: AiCommandDependencies,
): Promise<DataCommandOutput<"ai.testProvider">> {
  return withAiRun(input.requestId, dependencies, async (signal) => {
    const provider = await createAiProvider(dependencies);
    const response = await provider.generateText({
      maxTokens: 10,
      messages: [{ content: "Reply with exactly: ok", role: "user" }],
      signal,
    });
    assertAiRunNotAborted(signal);
    return { text: boundedAiTestResponse(response.text) };
  });
}

function createAiProvider(dependencies: AiCommandDependencies): Promise<AIProvider> {
  return dependencies.providerFactory?.() ?? createConfiguredAiProvider();
}

async function withAiRun<T>(
  requestId: string,
  dependencies: AiCommandDependencies,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const runs = aiRuns(dependencies);
  let began = false;
  try {
    const signal = runs.begin(requestId);
    began = true;
    const result = await operation(signal);
    assertAiRunNotAborted(signal);
    return result;
  } catch (error) {
    throw toSafeError(error);
  } finally {
    if (began) runs.end(requestId);
  }
}

/**
 * This is the last cancellable point before a short repository-owned commit.
 * A cancellation arriving after this check races a completed durable commit;
 * it never rolls that commit back or records a second failure.
 */
function assertAiRunNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("AI request cancelled");
  error.name = "AbortError";
  throw error;
}

function executeAiInternalLease<T>(
  dependencies: AiCommandDependencies,
  commandName: AiDataCommandName,
  operation: (database: Database) => T | Promise<T>,
): Promise<T> {
  if (!dependencies.execute) throw new Error("Main-process AI command execution is unavailable");
  // `DataCommandDependencies.execute` models renderer-visible DTOs. These
  // transient title/scope values never leave main, so keep the cast isolated
  // at this internal coordinator adapter rather than widening the public map.
  return dependencies.execute(
    commandName,
    operation as unknown as (
      database: Database,
    ) => DataCommandOutput<typeof commandName> | Promise<DataCommandOutput<typeof commandName>>,
  ) as unknown as Promise<T>;
}

async function assertCanvasSourcesInActiveLibrary(
  database: Database,
  libraryId: string,
  sources: readonly AiCanvasSynthesisSource[],
): Promise<void> {
  const workIds = [...new Set(sources.map((source) => source.workId))];
  const placeholders = workIds.map(() => "?").join(",");
  const rows = await database.query<{ id: string }>(
    `SELECT id
     FROM works
     WHERE library_id = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders})`,
    [libraryId, ...workIds],
  );
  if (new Set(rows.map((row) => row.id)).size !== workIds.length) {
    throw new Error("Canvas 来源文献不存在、已在回收站，或不属于当前文献库");
  }
}

function toProviderCanvasSource(source: AiCanvasSynthesisSource): CanvasSynthesisSource {
  return {
    content: source.content,
    id: source.id,
    kind: source.kind,
    title: source.title,
  };
}

function assertBoundedCanvasSynthesisOutput(value: {
  contentMarkdown: string;
  structuredTable?: { headers: string[]; rows: string[][] };
  title: string;
}): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_AI_CANVAS_OUTPUT_BYTES) {
    throw new Error(`AI Canvas synthesis output is limited to ${MAX_AI_CANVAS_OUTPUT_BYTES} bytes`);
  }
}

function boundedAiTestResponse(value: string): string {
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") <= MAX_AI_TEST_RESPONSE_BYTES) {
    return normalized || "（模型未返回文本）";
  }
  return Buffer.from(normalized, "utf8").subarray(0, MAX_AI_TEST_RESPONSE_BYTES).toString("utf8");
}

async function requireActiveLocalLibraryId(database: Database): Promise<string> {
  const libraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  return libraryId;
}

async function findActiveWorkTitle(
  database: Database,
  libraryId: string,
  workId: string,
): Promise<string | null> {
  const rows = await database.query<{ title: string }>(
    `SELECT title
     FROM works
     WHERE id = ? AND library_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [workId, libraryId],
  );
  return rows[0]?.title ?? null;
}

async function commitFlashcardGeneration(
  database: Database,
  libraryId: string,
  input: AiCommitFlashcardGenerationCommandInput,
  title: string,
): Promise<{ created: number }> {
  const cards = flashcardsToCards(input.result, title);
  // FlashcardsRepo.createMany owns a BEGIN/COMMIT transaction. This handler
  // deliberately uses the outer coordinator execute lease rather than nesting
  // another data-command transaction around it, preserving the prior flow.
  const generationId = newId();
  const ids = await new FlashcardsRepo(database, libraryId).createMany(
    cards.map((card) => ({
      aiModel: input.model,
      backMd: card.backMd,
      cardType: card.cardType,
      frontMd: card.frontMd,
      generationId,
      source: "ai",
      workId: input.workId,
    })),
  );
  const now = Date.now();
  await database.run(
    `INSERT INTO ai_jobs
       (id, library_id, kind, work_id, status, model, prompt_version, result_json, created_at, updated_at)
     VALUES (?, ?, 'flashcards', ?, 'done', ?, ?, ?, ?, ?)`,
    [
      newId(),
      libraryId,
      input.workId,
      input.model,
      input.promptVersion,
      JSON.stringify(input.result),
      now,
      now,
    ],
  );
  return { created: ids.length };
}
