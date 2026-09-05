import type { Database } from "@aurascholar/db";
import { ensureLocalFirstState } from "@aurascholar/db/local-first";
import { runMigrations } from "@aurascholar/db/migrations";
import { createNodeDatabase } from "@aurascholar/db/node";
import { WorksRepo } from "@aurascholar/db/repos/works";
import type { AIProvider } from "@aurascholar/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiDataCommandInput,
  AiDataCommandName,
  AiDataCommandOutput,
} from "../ai-command-contract";
import { DatabaseCoordinator } from "./database-coordinator";
import { executeAiCommand, type AiCommandDependencies, type AiCommandRequest } from "./ai-commands";
import { executeDataCommand, type DataCommandDependencies } from "./data-commands";
import { MainAiRunRegistry } from "./ai-run-registry";
import {
  AI_API_KEY_SECRET_KEY,
  MainAiSettingsStore,
  type MainAiSecretStore,
} from "./ai-settings-store";

let coordinator: DatabaseCoordinator;
let database: Database;
let dependencies: AiCommandDependencies;
let libraryId: string;
let works: WorksRepo;

class MemoryAiSecrets implements MainAiSecretStore {
  readonly values = new Map<string, string>();

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

beforeEach(async () => {
  database = await createNodeDatabase(":memory:");
  await runMigrations(database);
  ({ libraryId } = await ensureLocalFirstState(database, {
    deviceId: "ai-command-test-device",
    deviceName: "AI command tests",
    platform: "test",
  }));
  coordinator = new DatabaseCoordinator(database);
  dependencies = {
    execute: (_commandName, operation) => coordinator.execute(operation),
  };
  works = new WorksRepo(database, libraryId);
});

function command<K extends AiDataCommandName>(
  name: K,
  input: AiDataCommandInput<K>,
  commandDependencies = dependencies,
): Promise<AiDataCommandOutput<K>> {
  return executeAiCommand({ input, name } as AiCommandRequest, commandDependencies) as Promise<
    AiDataCommandOutput<K>
  >;
}

function generation() {
  return {
    contributions: ["A durable, testable contribution."],
    limitations: "The evaluation uses a small dataset.",
    method: "A scoped, main-process command boundary.",
    problem: "Renderer raw SQL can bypass ownership checks.",
    qaCards: [
      { a: "It derives Library scope in main.", q: "What protects Library scope?" },
      { a: "The repository owns the inner transaction.", q: "Who owns card writes?" },
    ],
    results: "The write surface is narrowed.",
    tldr: "AI flashcards persist through a typed command.",
  };
}

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    generateObject: vi.fn(async () => generation()),
    generateText: vi.fn(async () => ({ text: "ok" })),
    id: "test-main-provider",
    model: "main-owned-model",
    ...overrides,
  } as AIProvider;
}

describe("AI flashcard data commands", () => {
  it("rejects malformed or scope-injected input before acquiring a main-process lease", async () => {
    let executeCalls = 0;
    const rejectingDependencies: AiCommandDependencies = {
      async execute(_commandName, _operation) {
        executeCalls += 1;
        throw new Error("lease reached");
      },
    };
    const invalidRequests: unknown[] = [
      { input: {}, name: "ai.getFlashcardTarget" },
      { input: { workId: "work-1", libraryId: "library:foreign" }, name: "ai.getFlashcardTarget" },
      {
        input: {
          model: "model",
          promptVersion: "flashcards-v1",
          result: { ...generation(), qaCards: [] },
          workId: "work-1",
        },
        name: "ai.commitFlashcardGeneration",
      },
      {
        input: { error: "safe failure", libraryId: "library:foreign", workId: "work-1" },
        name: "ai.recordFlashcardFailure",
      },
    ];

    for (const request of invalidRequests) {
      await expect(
        executeAiCommand(request as AiCommandRequest, rejectingDependencies),
      ).rejects.toThrow();
    }
    expect(executeCalls).toBe(0);
  });

  it("exposes only active works in the durable local Library", async () => {
    const active = await works.upsert({ title: "Active AI target" });
    const deleted = await works.upsert({ title: "Deleted AI target" });
    await works.softDelete(deleted.id);

    const foreignLibraryId = "library:foreign-ai-command";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign AI Library', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreign = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign AI target",
    });

    await expect(command("ai.getFlashcardTarget", { workId: active.id })).resolves.toEqual({
      active: true,
    });
    for (const workId of [deleted.id, foreign.id, "work:missing"]) {
      await expect(command("ai.getFlashcardTarget", { workId })).resolves.toEqual({
        active: false,
      });
    }
  });

  it("routes AI target checks through the central coordinator execute adapter", async () => {
    const work = await works.upsert({ title: "Central AI route" });
    const executedCommands: string[] = [];
    const routerDependencies: DataCommandDependencies = {
      execute(commandName, operation) {
        executedCommands.push(commandName);
        return coordinator.execute(operation);
      },
      async transaction() {
        throw new Error("AI target checks must not open a transaction");
      },
    };

    await expect(
      executeDataCommand(
        { input: { workId: work.id }, name: "ai.getFlashcardTarget" },
        routerDependencies,
      ),
    ).resolves.toEqual({ active: true });
    expect(executedCommands).toEqual(["ai.getFlashcardTarget"]);
  });

  it("keeps a failed settings save on the typed main command route and restores its key", async () => {
    const secrets = new MemoryAiSecrets();
    const settings = new MainAiSettingsStore({
      secrets,
      withDatabase: (operation) => coordinator.execute(operation),
      withDatabaseTransaction: (commandName, operation) =>
        coordinator.transaction(commandName, operation),
    });
    const commandDependencies: AiCommandDependencies = { ...dependencies, settings };
    await command(
      "ai.saveSettings",
      {
        apiKey: "previous-main-key",
        baseUrl: "https://ai.example.test/previous",
        kind: "openai-compatible",
        model: "previous-model",
      },
      commandDependencies,
    );
    await database.exec(`
      CREATE TRIGGER aurascholar_ai_settings_command_failure
      BEFORE UPDATE OF value_json ON settings
      WHEN OLD.key = 'local.ai.provider.v1'
      BEGIN
        SELECT RAISE(FAIL, 'Smoke settings AI save failure');
      END;
    `);

    try {
      await expect(
        command(
          "ai.saveSettings",
          {
            apiKey: "replacement-main-key",
            baseUrl: "https://ai.example.test/replacement",
            kind: "openai-compatible",
            model: "replacement-model",
          },
          commandDependencies,
        ),
      ).rejects.toThrow("Smoke settings AI save failure");
    } finally {
      await database.exec("DROP TRIGGER aurascholar_ai_settings_command_failure");
    }

    expect(secrets.values.get(AI_API_KEY_SECRET_KEY)).toBe("previous-main-key");
    await expect(command("ai.getSettings", {}, commandDependencies)).resolves.toEqual({
      baseUrl: "https://ai.example.test/previous",
      hasApiKey: true,
      kind: "openai-compatible",
      model: "previous-model",
    });
  });

  it("uses the coordinator execute lease while preserving the repository-owned card transaction", async () => {
    const work = await works.upsert({ title: "AI command persistence" });
    let executeCalls = 0;
    const countingDependencies: AiCommandDependencies = {
      async execute(_commandName, operation) {
        executeCalls += 1;
        return coordinator.execute(operation);
      },
    };

    await expect(
      command(
        "ai.commitFlashcardGeneration",
        {
          model: "test-model",
          promptVersion: "flashcards-v1",
          result: generation(),
          workId: work.id,
        },
        countingDependencies,
      ),
    ).resolves.toEqual({ created: 6 });
    expect(executeCalls).toBe(1);

    const cards = await database.query<{
      ai_model: string | null;
      front_md: string;
      generation_id: string | null;
      source: string;
      work_id: string;
    }>(
      `SELECT ai_model, front_md, generation_id, source, work_id
       FROM flashcards ORDER BY created_at, id`,
    );
    expect(cards).toHaveLength(6);
    expect(cards).toEqual(
      Array.from({ length: 6 }, () =>
        expect.objectContaining({
          ai_model: "test-model",
          source: "ai",
          work_id: work.id,
        }),
      ),
    );
    expect(new Set(cards.map((card) => card.generation_id)).size).toBe(1);
    expect(cards[0]?.front_md).toContain("AI command persistence");

    const jobs = await database.query<{
      library_id: string;
      model: string | null;
      prompt_version: string | null;
      result_json: string | null;
      status: string;
      work_id: string | null;
    }>(
      `SELECT library_id, model, prompt_version, result_json, status, work_id
       FROM ai_jobs`,
    );
    expect(jobs).toEqual([
      expect.objectContaining({
        library_id: libraryId,
        model: "test-model",
        prompt_version: "flashcards-v1",
        result_json: JSON.stringify(generation()),
        status: "done",
        work_id: work.id,
      }),
    ]);
  });

  it("fails closed for a removed or foreign commit target without durable writes", async () => {
    const deleted = await works.upsert({ title: "Deleted commit target" });
    await works.softDelete(deleted.id);
    const foreignLibraryId = "library:foreign-ai-commit";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign AI Commit Library', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreign = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign commit target",
    });

    for (const workId of [deleted.id, foreign.id]) {
      await expect(
        command("ai.commitFlashcardGeneration", {
          model: "test-model",
          promptVersion: "flashcards-v1",
          result: generation(),
          workId,
        }),
      ).rejects.toThrow("Work is missing, removed, or outside the active Library");
    }
    await expect(database.query(`SELECT id FROM flashcards`)).resolves.toEqual([]);
    await expect(database.query(`SELECT id FROM ai_jobs`)).resolves.toEqual([]);
  });

  it("records only a safe failure for an active local target", async () => {
    const active = await works.upsert({ title: "Failure target" });
    const deleted = await works.upsert({ title: "Deleted failure target" });
    await works.softDelete(deleted.id);

    await expect(
      command("ai.recordFlashcardFailure", { error: "network timeout", workId: active.id }),
    ).resolves.toEqual({ recorded: true });
    await expect(
      command("ai.recordFlashcardFailure", { error: "network timeout", workId: deleted.id }),
    ).resolves.toEqual({ recorded: false });
    await expect(
      command("ai.recordFlashcardFailure", { error: "network timeout", workId: "work:missing" }),
    ).resolves.toEqual({ recorded: false });

    await expect(
      database.query<{
        error: string | null;
        library_id: string;
        status: string;
        work_id: string | null;
      }>(`SELECT error, library_id, status, work_id FROM ai_jobs`),
    ).resolves.toEqual([
      {
        error: "network timeout",
        library_id: libraryId,
        status: "error",
        work_id: active.id,
      },
    ]);
  });

  it("generates and commits flashcards entirely in main with a rechecked active target", async () => {
    const work = await works.upsert({ title: "Main-owned provider target" });
    const configuredProvider = provider();
    const providerFactory = vi.fn(async () => configuredProvider);
    const commandDependencies: AiCommandDependencies = {
      ...dependencies,
      providerFactory,
      runs: new MainAiRunRegistry(),
    };

    await expect(
      command(
        "ai.generateFlashcards",
        {
          paperText: "A sufficiently long paper body ".repeat(30),
          requestId: "flashcards-main-owned-1",
          workId: work.id,
        },
        commandDependencies,
      ),
    ).resolves.toEqual({ created: 6 });

    expect(providerFactory).toHaveBeenCalledOnce();
    expect(configuredProvider.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await expect(
      database.query<{ ai_model: string; work_id: string }>(
        "SELECT ai_model, work_id FROM flashcards ORDER BY created_at, id",
      ),
    ).resolves.toEqual(
      Array.from({ length: 6 }, () => ({ ai_model: "main-owned-model", work_id: work.id })),
    );
  });

  it("rejects provider-target injection before opening a lease or provider factory", async () => {
    const providerFactory = vi.fn(async () => provider());
    let executeCalls = 0;
    const commandDependencies: AiCommandDependencies = {
      async execute(_commandName, _operation) {
        executeCalls += 1;
        throw new Error("lease reached");
      },
      providerFactory,
      runs: new MainAiRunRegistry(),
    };

    for (const input of [
      {
        baseUrl: "https://attacker.example",
        paperText: "body",
        requestId: "flashcards-injection-url",
        workId: "work-1",
      },
      {
        apiKey: "main-key",
        paperText: "body",
        requestId: "flashcards-injection-key",
        workId: "work-1",
      },
      {
        model: "attacker-model",
        paperText: "body",
        requestId: "flashcards-injection-model",
        workId: "work-1",
      },
    ]) {
      await expect(
        executeAiCommand(
          { input, name: "ai.generateFlashcards" } as AiCommandRequest,
          commandDependencies,
        ),
      ).rejects.toThrow("Invalid ai.generateFlashcards input");
    }
    expect(executeCalls).toBe(0);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("rejects endpoint or model injection on every other provider egress command", async () => {
    const providerFactory = vi.fn(async () => provider());
    let executeCalls = 0;
    const commandDependencies: AiCommandDependencies = {
      async execute(_commandName, _operation) {
        executeCalls += 1;
        throw new Error("lease reached");
      },
      providerFactory,
      runs: new MainAiRunRegistry(),
    };

    const requests: unknown[] = [
      {
        input: {
          baseUrl: "https://attacker.example",
          requestId: "test-provider-injection-url",
        },
        name: "ai.testProvider",
      },
      {
        input: {
          mode: "tldr",
          model: "attacker-model",
          requestId: "canvas-provider-injection-model",
          sources: [
            {
              content: "First source",
              id: "canvas-injection-source-1",
              kind: "paper",
              title: "First source",
              workId: "work-1",
            },
            {
              content: "Second source",
              id: "canvas-injection-source-2",
              kind: "excerpt",
              title: "Second source",
              workId: "work-2",
            },
          ],
        },
        name: "ai.synthesizeCanvas",
      },
      {
        input: {
          model: "attacker-model",
          query: "What was the design?",
          requestId: "document-provider-injection-model",
          workId: "work-1",
        },
        name: "ai.synthesizeDocument",
      },
    ];

    for (const request of requests) {
      await expect(
        executeAiCommand(request as AiCommandRequest, commandDependencies),
      ).rejects.toThrow(/^Invalid ai\.(?:testProvider|synthesizeCanvas|synthesizeDocument) input$/);
    }
    expect(executeCalls).toBe(0);
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("cancels an active provider call without creating cards or an error job", async () => {
    const work = await works.upsert({ title: "Cancellable AI target" });
    let observedSignal: AbortSignal | null = null;
    const configuredProvider = provider({
      generateObject: vi.fn(
        async ({ signal }: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            observedSignal = signal ?? null;
            signal?.addEventListener(
              "abort",
              () => {
                const error = new Error("Request aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      ) as AIProvider["generateObject"],
    });
    const commandDependencies: AiCommandDependencies = {
      ...dependencies,
      providerFactory: vi.fn(async () => configuredProvider),
      runs: new MainAiRunRegistry(),
    };
    const pending = command(
      "ai.generateFlashcards",
      {
        paperText: "A cancellable paper body ".repeat(30),
        requestId: "flashcards-cancel-1",
        workId: work.id,
      },
      commandDependencies,
    );
    await vi.waitFor(() => expect(observedSignal).not.toBeNull());

    await expect(
      command("ai.cancelRun", { requestId: "flashcards-cancel-1" }, commandDependencies),
    ).resolves.toEqual({ cancelled: true });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      command("ai.cancelRun", { requestId: "flashcards-cancel-1" }, commandDependencies),
    ).resolves.toEqual({ cancelled: false });
    await expect(database.query("SELECT id FROM flashcards")).resolves.toEqual([]);
    await expect(database.query("SELECT id FROM ai_jobs")).resolves.toEqual([]);
  });

  it("proves every Canvas source work belongs to the active Library before provider egress", async () => {
    const active = await works.upsert({ title: "Active Canvas source" });
    const foreignLibraryId = "library:foreign-canvas-source";
    await database.run(
      `INSERT INTO libraries (id, name, kind, created_at, updated_at)
       VALUES (?, 'Foreign Canvas Library', 'personal', 1, 1)`,
      [foreignLibraryId],
    );
    const foreign = await new WorksRepo(database, foreignLibraryId).upsert({
      title: "Foreign Canvas source",
    });
    const providerFactory = vi.fn(async () => provider());
    const commandDependencies: AiCommandDependencies = {
      ...dependencies,
      providerFactory,
      runs: new MainAiRunRegistry(),
    };

    await expect(
      command(
        "ai.synthesizeCanvas",
        {
          mode: "tldr",
          requestId: "canvas-foreign-source-1",
          sources: [
            {
              content: "Active source text",
              id: "canvas-active-source",
              kind: "paper",
              title: "Active source",
              workId: active.id,
            },
            {
              content: "Foreign source text",
              id: "canvas-foreign-source",
              kind: "excerpt",
              title: "Foreign source",
              workId: foreign.id,
            },
          ],
        },
        commandDependencies,
      ),
    ).rejects.toThrow("不属于当前文献库");
    expect(providerFactory).not.toHaveBeenCalled();
  });

});
