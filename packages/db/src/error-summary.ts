import { redactSensitiveText } from "@aurascholar/platform";

const MAX_PERSISTED_ERROR_LENGTH = 500;

export function summarizePersistedError(value: string): string {
  return redactSensitiveText(value).replace(/\s+/g, " ").trim().slice(0, MAX_PERSISTED_ERROR_LENGTH);
}
