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
  const trimmed = value.trim();
  if (trimmed) await window.aura.secrets.set(key, trimmed);
  else await window.aura.secrets.delete(key);
}

/**
 * One-time migration: if an old localStorage record still carries a plaintext
 * key inline, move it into the secret store. Returns the migrated value (so the
 * caller can use it immediately) or "". Idempotent — once the inline value is
 * gone, this is a no-op. The caller is responsible for rewriting localStorage
 * without the inline key.
 */
export async function migrateInlineSecret(
  secretKey: string,
  inlineValue: string | undefined | null,
): Promise<string> {
  const value = (inlineValue ?? "").trim();
  if (!value || !available()) return value;
  try {
    // Don't clobber an already-stored secret with a stale inline copy.
    const existing = await window.aura.secrets.get(secretKey);
    if (!existing) await window.aura.secrets.set(secretKey, value);
    return existing || value;
  } catch {
    return value;
  }
}
