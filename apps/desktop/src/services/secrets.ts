// Secret storage for BYOK keys (AI / translation / sync), backed by the main
// process's safeStorage-encrypted secrets.json (window.aura.secrets). Keys used
// to live inline in localStorage as plaintext; we now keep only non-secret
// config there and store the actual keys here. `migrateInlineSecret` moves any
// remaining plaintext key out of an old localStorage record on first read.

/** Secret-store keys. Namespaced to avoid collisions in secrets.json. */
export const SECRET_KEYS = {
  aiApiKey: "secret:ai:apiKey",
  translateDeepl: "secret:translate:deepl",
  translateBaidu: "secret:translate:baidu",
  syncPassword: "secret:sync:password",
} as const;

export interface InlineSecretMigrationResult {
  persisted: boolean;
  value: string;
}

function available(): boolean {
  return "aura" in window;
}

/** Read a stored secret, or "" when absent / unavailable (e.g. preview mode). */
export async function getSecret(key: string): Promise<string> {
  if (!available()) return "";
  try {
    return (await window.aura.secrets.get(key)) ?? "";
  } catch {
    return "";
  }
}

/** Store a secret; an empty value deletes it (so "" never counts as configured). */
export async function setSecret(key: string, value: string): Promise<void> {
  if (!available()) return;
  const smokeWindow = window as Window & {
    __AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__?: number;
    __AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__?: string;
  };
  const smokeFailure = smokeWindow.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
  const smokeFailureAfter = smokeWindow.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__;
  if (typeof smokeFailureAfter === "number") {
    if (smokeFailureAfter <= 0) {
      delete smokeWindow.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__;
      delete smokeWindow.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
      throw new Error(smokeFailure || "Smoke secret write failure");
    }
    smokeWindow.__AURASCHOLAR_SMOKE_FAIL_SECRET_WRITE_AFTER__ = smokeFailureAfter - 1;
  } else if (smokeFailure) {
    delete smokeWindow.__AURASCHOLAR_SMOKE_FAIL_NEXT_SECRET_WRITE__;
    throw new Error(smokeFailure);
  }
  const trimmed = value.trim();
  if (trimmed) await window.aura.secrets.set(key, trimmed);
  else await window.aura.secrets.delete(key);
}

export async function withSecretTransaction<T>(
  updates: Array<{ key: string; value: string }>,
  commit: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string>();
  for (const update of updates) {
    if (!previous.has(update.key)) previous.set(update.key, await getSecret(update.key));
  }

  const applied: string[] = [];
  try {
    for (const update of updates) {
      await setSecret(update.key, update.value);
      applied.push(update.key);
    }
    return await commit();
  } catch (error) {
    for (const key of applied.reverse()) {
      try {
        await setSecret(key, previous.get(key) ?? "");
      } catch {
        // Preserve the original save failure; the UI should surface the cause
        // that prevented the settings transaction from completing.
      }
    }
    throw error;
  }
}

/**
 * One-time migration: if an old localStorage record still carries a plaintext
 * key inline, move it into the secret store. Migration is best-effort: when the
 * secret store cannot be written, callers still receive the inline value and
 * must keep it in localStorage so the old configuration remains usable.
 */
export async function migrateInlineSecret(
  secretKey: string,
  inlineValue: string | undefined | null,
): Promise<InlineSecretMigrationResult> {
  const value = (inlineValue ?? "").trim();
  if (!value) return { persisted: false, value };
  if (!available()) return { persisted: false, value };
  try {
    // Don't clobber an already-stored secret with a stale inline copy.
    const existing = await window.aura.secrets.get(secretKey);
    if (existing) return { persisted: true, value: existing };
    await setSecret(secretKey, value);
    return { persisted: true, value };
  } catch {
    return { persisted: false, value };
  }
}
