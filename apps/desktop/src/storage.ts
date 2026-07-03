function storageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isStorageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readLocalStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function tryWriteLocalStorageItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function writeLocalStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    throw new Error(`无法保存本地设置 ${key}: ${storageErrorMessage(error)}`, { cause: error });
  }
}

export function readLocalStorageJson<T>(key: string, fallback: T): T {
  const raw = readLocalStorageItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function tryWriteLocalStorageJson(key: string, value: unknown): boolean {
  try {
    return tryWriteLocalStorageItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

export function writeLocalStorageJson(key: string, value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`无法序列化本地设置 ${key}: ${storageErrorMessage(error)}`, {
      cause: error,
    });
  }
  writeLocalStorageItem(key, serialized);
}
