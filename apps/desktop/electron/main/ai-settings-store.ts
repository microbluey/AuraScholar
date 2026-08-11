import { Buffer } from "node:buffer";
import type { Database } from "@aurascholar/db";
import type {
  AiAdoptLegacySettingsCommandInput,
  AiProviderKind,
  AiSaveSettingsCommandInput,
  AiSettingsSnapshot,
} from "../ai-command-contract";
import { withMainDatabase, withMainDatabaseTransaction } from "./db";
import { deleteMainSecret, getMainSecret, setMainSecret } from "./platform";

export const AI_API_KEY_SECRET_KEY = "secret:ai:apiKey";
export const AI_SETTINGS_DATABASE_KEY = "local.ai.provider.v1";

const MAX_AI_API_KEY_BYTES = 16 * 1024;
const MAX_AI_BASE_URL_BYTES = 8 * 1024;
const MAX_AI_MODEL_BYTES = 4 * 1024;

interface MainAiTarget {
  baseUrl: string;
  kind: AiProviderKind;
  model: string;
}

interface AiTargetWithKeyBinding extends MainAiTarget {
  /** Proves the current target was explicitly saved with its credential. */
  apiKeyBound: boolean;
}

interface StoredAiTarget extends AiTargetWithKeyBinding {
  version: 2;
}

export interface MainAiSettings extends MainAiTarget {
  apiKey: string;
}

export interface MainAiSecretStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface MainAiSettingsStoreDependencies {
  secrets: MainAiSecretStore;
  withDatabase<T>(operation: (database: Database) => T | Promise<T>): Promise<T>;
  withDatabaseTransaction<T>(
    commandName: string,
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T>;
}

/**
 * Main-only owner for both the provider target and its credential binding.
 * A renderer may replace the target only through `save`; it cannot hand a
 * target to a provider invocation, nor redirect an existing secret without
 * explicitly supplying a replacement key for that new target.
 */
export class MainAiSettingsStore {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: MainAiSettingsStoreDependencies) {}

  async getSnapshot(): Promise<AiSettingsSnapshot | null> {
    const [target, apiKey] = await Promise.all([this.readTarget(), this.readApiKey()]);
    return target ? toSnapshot(target, apiKey) : null;
  }

  async requireSettings(): Promise<MainAiSettings> {
    const [target, apiKey] = await Promise.all([this.readTarget(), this.readApiKey()]);
    if (!target || !target.apiKeyBound || !apiKey) {
      throw new Error("请先在设置页配置 AI 服务(地址、模型与 API Key)");
    }
    return {
      apiKey,
      baseUrl: target.baseUrl,
      kind: target.kind,
      model: target.model,
    };
  }

  save(input: AiSaveSettingsCommandInput): Promise<AiSettingsSnapshot> {
    return this.mutate(async () => {
      const target = normalizeAiTarget(input);
      const previousTarget = await this.readTarget();
      const previousApiKey = await this.readApiKey();
      const targetChanged = !previousTarget || !sameAiTarget(previousTarget, target);
      const replacementApiKey =
        input.apiKey === undefined ? undefined : normalizeAiApiKey(input.apiKey);

      // A renderer that has no Key read capability must not be able to point a
      // stored Key at a new host. Re-entering a Key is the explicit rebinding
      // ceremony for any changed endpoint/model/provider kind.
      if (
        !replacementApiKey &&
        (!previousTarget?.apiKeyBound || !previousApiKey || targetChanged)
      ) {
        throw new Error(
          previousApiKey
            ? "更改 AI 服务地址、类型或模型时，请重新填写 API Key。"
            : "请填写 API Key。本地兼容端点也可以填写占位 Key。",
        );
      }
      const nextApiKey = replacementApiKey ?? previousApiKey;
      if (!nextApiKey) {
        throw new Error("请填写 API Key。本地兼容端点也可以填写占位 Key。");
      }

      if (replacementApiKey) {
        await this.dependencies.secrets.set(AI_API_KEY_SECRET_KEY, replacementApiKey);
      }
      try {
        await this.writeTarget({ ...target, apiKeyBound: true });
      } catch (error) {
        if (replacementApiKey) {
          await restoreApiKey(this.dependencies.secrets, previousApiKey, error);
        }
        throw error;
      }
      return toSnapshot({ ...target, apiKeyBound: true }, nextApiKey);
    });
  }

  /**
   * Safe one-time transfer from pre-R4 renderer localStorage. A legacy target
   * without a co-located plaintext key deliberately does not bind to the old
   * named secret: that unbound secret might otherwise be redirected by stale
   * renderer state. The user must re-enter it through `save`.
   */
  adoptLegacy(input: AiAdoptLegacySettingsCommandInput): Promise<AiSettingsSnapshot | null> {
    return this.mutate(async () => {
      const existing = await this.readTarget();
      if (existing) {
        return toSnapshot(existing, await this.readApiKey());
      }

      const target = normalizeAiTarget(input);
      const previousApiKey = await this.readApiKey();
      const inlineApiKey =
        input.inlineApiKey === undefined ? undefined : normalizeAiApiKey(input.inlineApiKey);

      if (inlineApiKey) {
        await this.dependencies.secrets.set(AI_API_KEY_SECRET_KEY, inlineApiKey);
      }
      try {
        await this.writeTarget({ ...target, apiKeyBound: Boolean(inlineApiKey) });
      } catch (error) {
        if (inlineApiKey) {
          await restoreApiKey(this.dependencies.secrets, previousApiKey, error);
        }
        throw error;
      }

      // Do not return or use `previousApiKey` here. It belongs to an old,
      // unbound configuration and must not be paired with renderer-provided
      // legacy target fields.
      return toSnapshot({ ...target, apiKeyBound: Boolean(inlineApiKey) }, inlineApiKey ?? null);
    });
  }

  private async readTarget(): Promise<StoredAiTarget | null> {
    return this.dependencies.withDatabase(async (database) => {
      const rows = await database.query<{ value_json: string | null }>(
        "SELECT value_json FROM settings WHERE key = ? LIMIT 1",
        [AI_SETTINGS_DATABASE_KEY],
      );
      return parseStoredAiTarget(rows[0]?.value_json);
    });
  }

  private async writeTarget(target: AiTargetWithKeyBinding): Promise<void> {
    const stored: StoredAiTarget = { ...target, version: 2 };
    await this.dependencies.withDatabaseTransaction("ai.saveSettings", async (database) => {
      await database.run(
        `INSERT INTO settings (key, value_json, scope, updated_at)
         VALUES (?, ?, 'local', ?)
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           scope = 'local',
           updated_at = excluded.updated_at`,
        [AI_SETTINGS_DATABASE_KEY, JSON.stringify(stored), Date.now()],
      );
    });
  }

  private async readApiKey(): Promise<string | null> {
    const value = await this.dependencies.secrets.get(AI_API_KEY_SECRET_KEY);
    return value?.trim() || null;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation);
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export const mainAiSettingsStore = new MainAiSettingsStore({
  secrets: {
    delete: deleteMainSecret,
    get: getMainSecret,
    set: setMainSecret,
  },
  withDatabase: withMainDatabase,
  withDatabaseTransaction: withMainDatabaseTransaction,
});

export function normalizeAiTarget(value: {
  baseUrl: unknown;
  kind: unknown;
  model: unknown;
}): MainAiTarget {
  const kind = normalizeAiProviderKind(value.kind);
  return {
    baseUrl: normalizeAiBaseUrl(kind, value.baseUrl),
    kind,
    model: requireAiConfigText(value.model, "AI 模型名称", MAX_AI_MODEL_BYTES),
  };
}

export function normalizeAiApiKey(value: unknown): string {
  const normalized = requireAiConfigText(value, "API Key", MAX_AI_API_KEY_BYTES);
  if (hasDisallowedControlCharacter(normalized)) {
    throw new Error("API Key 包含不支持的控制字符。");
  }
  return normalized;
}

function normalizeAiProviderKind(value: unknown): AiProviderKind {
  if (value === "openai-compatible" || value === "anthropic") return value;
  throw new Error("AI 服务类型不受支持。");
}

function normalizeAiBaseUrl(kind: AiProviderKind, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("AI API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  const raw = value.trim();
  if (!raw) {
    if (kind === "anthropic") return "";
    throw new Error("请填写 OpenAI 兼容 API 地址。");
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_AI_BASE_URL_BYTES) {
    throw new Error("AI API 地址过长。");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("AI API 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AI API 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("AI API 地址不要包含密钥或账号，请填写在 API Key 字段中。");
  }
  if (url.search || url.hash) {
    throw new Error("AI API 地址请填写接口根地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

function requireAiConfigText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文本。`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`请填写${label}。`);
  if (Buffer.byteLength(normalized, "utf8") > maximumBytes) {
    throw new Error(`${label}过长。`);
  }
  return normalized;
}

function parseStoredAiTarget(value: string | null | undefined): StoredAiTarget | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 2 || typeof parsed.apiKeyBound !== "boolean") {
      // A v1 target has no durable proof that its named secret belongs to this
      // endpoint. Treat it as absent rather than guessing a binding.
      return null;
    }
    return {
      ...normalizeAiTarget({
        baseUrl: parsed.baseUrl,
        kind: parsed.kind,
        model: parsed.model,
      }),
      apiKeyBound: parsed.apiKeyBound,
      version: 2,
    };
  } catch {
    return null;
  }
}

function toSnapshot(target: AiTargetWithKeyBinding, apiKey: string | null): AiSettingsSnapshot {
  return {
    baseUrl: target.baseUrl,
    hasApiKey: target.apiKeyBound && Boolean(apiKey),
    kind: target.kind,
    model: target.model,
  };
}

function sameAiTarget(a: MainAiTarget, b: MainAiTarget): boolean {
  return a.baseUrl === b.baseUrl && a.kind === b.kind && a.model === b.model;
}

function hasDisallowedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function restoreApiKey(
  secrets: MainAiSecretStore,
  previous: string | null,
  cause: unknown,
): Promise<void> {
  try {
    if (previous) await secrets.set(AI_API_KEY_SECRET_KEY, previous);
    else await secrets.delete(AI_API_KEY_SECRET_KEY);
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "AI settings save failed and the API Key rollback also failed",
      { cause: rollbackError },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
