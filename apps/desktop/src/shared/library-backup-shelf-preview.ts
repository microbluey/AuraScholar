/**
 * Structural validation for the renderer-safe preview embedded in a Shelf
 * backup row. The import graph validator owns relationships; this module
 * keeps the payload contract in one small, alias-aware helper.
 */
export function assertShelfPreviewShape(preview: Record<string, unknown>, version: number): void {
  requireId(
    aliasedPreviewValue(preview, "contentUnitId", "content_unit_id"),
    "contentUnitId",
    version,
  );
  assertText(preview, "excerpt", version);
  assertText(preview, "text", version);
  assertStringOrNull(preview, "language", 128, version);
  assertStringOrNull(preview, "workTitle", 4_096, version, "work_title");

  const headingPath = aliasedPreviewValue(preview, "headingPath", "heading_path");
  if (
    headingPath !== null &&
    (!Array.isArray(headingPath) ||
      headingPath.length > 64 ||
      headingPath.some(
        (part) => typeof part !== "string" || part.length === 0 || part.length > 256,
      ))
  ) {
    invalid("headingPath", version);
  }
  assertInteger(preview, "ordinal", 0, version);
  const tokenCount = aliasedPreviewValue(preview, "tokenCount", "token_count");
  if (
    tokenCount !== null &&
    (typeof tokenCount !== "number" || !Number.isSafeInteger(tokenCount) || tokenCount < 0)
  ) {
    invalid("tokenCount", version);
  }
}

export function aliasedPreviewValue(
  preview: Record<string, unknown>,
  camelField: string,
  snakeField: string,
): unknown {
  const hasCamel = Object.hasOwn(preview, camelField);
  const hasSnake = snakeField !== camelField && Object.hasOwn(preview, snakeField);
  if (!hasCamel && !hasSnake) {
    throw new Error(`Shelf preview field ${camelField} is missing`);
  }
  if (hasCamel && hasSnake && stableJson(preview[camelField]) !== stableJson(preview[snakeField])) {
    throw new Error(`Shelf preview aliases disagree: ${camelField}`);
  }
  return hasCamel ? preview[camelField] : preview[snakeField];
}

function assertText(preview: Record<string, unknown>, field: string, version: number): void {
  const value = aliasedPreviewValue(preview, field, field);
  if (typeof value !== "string" || value.length === 0 || value.length > 256 * 1024) {
    invalid(field, version);
  }
}

function assertStringOrNull(
  preview: Record<string, unknown>,
  field: string,
  max: number,
  version: number,
  snakeField = toSnakeCase(field),
): void {
  const value = aliasedPreviewValue(preview, field, snakeField);
  if (value !== null && (typeof value !== "string" || value.length === 0 || value.length > max)) {
    invalid(field, version);
  }
}

function assertInteger(
  preview: Record<string, unknown>,
  field: string,
  minimum: number,
  version: number,
): void {
  const value = aliasedPreviewValue(preview, field, toSnakeCase(field));
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(field, version);
}

function requireId(value: unknown, field: string, version: number): void {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > 512) {
    invalid(field, version);
  }
}

function invalid(field: string, version: number): never {
  throw new Error(`v${version} 备份包含无效的 Shelf ${field}`);
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
