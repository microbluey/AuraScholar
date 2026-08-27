import type { Bounds } from "../shared";
import { normalizeProxyAddress } from "./discovery-site-command-input";

const RESEARCH_PROTOCOLS = new Set(["http:", "https:"]);
const RESEARCH_SITE_ID_PATTERN = /^(?:builtin|custom):[A-Za-z0-9_-]+$/u;

/**
 * Browser sessions are keyed by a site id, not by an arbitrary renderer
 * string. Keep this limit below Electron's partition-name limits and reject
 * characters that the legacy sanitizer would otherwise collapse together.
 */
export const MAX_RESEARCH_SITE_ID_LENGTH = 256;
export const MAX_RESEARCH_URL_LENGTH = 16 * 1024;
export const MAX_RESEARCH_TAB_ID_LENGTH = 128;
// Keep this in step with the discovery-site list cap so a full site catalog can
// still be inspected in one call.
export const MAX_RESEARCH_SITE_IDS = 1_000;
export const MAX_RESEARCH_TABS = 128;
export const MAX_RESEARCH_PROXY_LENGTH = 2_048;
export const MAX_RESEARCH_BOUNDS_COORDINATE = 1_000_000;
export const MAX_RESEARCH_BOUNDS_DIMENSION = 1_000_000;

/** Internal full-text handoffs use one reserved, non-persisted site bucket. */
export const RESEARCH_FULLTEXT_SITE_ID = "_fulltext";

export interface ResearchOpenOptions {
  reuseExisting?: boolean;
}

export interface ParsedResearchOpenInput {
  siteId: string;
  url: string;
  proxy: string;
  options?: ResearchOpenOptions;
}

/**
 * Validate the persisted/built-in site id before applying the historical
 * sanitizer. The reserved full-text bucket is the only non-canonical id and
 * is intentionally fixed, so it cannot collide with a persisted site id.
 */
export function validateResearchSiteId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RESEARCH_SITE_ID_LENGTH ||
    value.trim() !== value ||
    hasResearchControlCharacter(value) ||
    (value !== RESEARCH_FULLTEXT_SITE_ID && !RESEARCH_SITE_ID_PATTERN.test(value))
  ) {
    throw new Error("Research site id is invalid");
  }
  return value;
}

/**
 * Preserve existing session partitions for canonical ids. Validation makes the
 * old replacement sanitizer injective over the accepted id alphabet, so two
 * sites can no longer silently share cookies because of punctuation collapse.
 */
export function researchPartition(siteId: unknown): string {
  const validSiteId = validateResearchSiteId(siteId);
  return `persist:research-${validSiteId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function validateResearchUrl(rawUrl: unknown): URL {
  if (
    typeof rawUrl !== "string" ||
    rawUrl.length === 0 ||
    rawUrl.length > MAX_RESEARCH_URL_LENGTH ||
    rawUrl.trim() !== rawUrl ||
    hasResearchControlCharacter(rawUrl)
  ) {
    throw new Error("无效的研究浏览器地址");
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的研究浏览器地址");
  }
  if (!RESEARCH_PROTOCOLS.has(url.protocol)) {
    throw new Error(`研究浏览器不允许打开 ${url.protocol || "未知"} 协议`);
  }
  if (!url.hostname) {
    throw new Error("研究浏览器地址缺少主机名");
  }
  if (url.username || url.password) {
    throw new Error("研究浏览器地址不能包含用户名或密码");
  }
  return url;
}

/** Reuse the discovery settings' strict URL proxy parser at the IPC boundary. */
export function validateResearchProxy(value: unknown): string {
  if (typeof value === "string" && value.length > MAX_RESEARCH_PROXY_LENGTH) {
    throw new Error("Research proxy is too long");
  }
  return normalizeProxyAddress(value);
}

export function validateResearchTabId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RESEARCH_TAB_ID_LENGTH ||
    value.trim() !== value ||
    hasResearchControlCharacter(value)
  ) {
    throw new Error("Research tab id is invalid");
  }
  return value;
}

export function parseResearchOpenOptions(value: unknown): ResearchOpenOptions | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "reuseExisting")
  ) {
    throw new Error("Research open options are invalid");
  }
  const options = value as Record<string, unknown>;
  if (
    Object.hasOwn(options, "reuseExisting") &&
    options.reuseExisting !== undefined &&
    typeof options.reuseExisting !== "boolean"
  ) {
    throw new Error("Research reuse option is invalid");
  }
  return Object.hasOwn(options, "reuseExisting") && options.reuseExisting !== undefined
    ? { reuseExisting: options.reuseExisting as boolean }
    : {};
}

export function parseResearchOpenInput(
  siteId: unknown,
  url: unknown,
  proxy: unknown,
  options: unknown,
): ParsedResearchOpenInput {
  const parsedOptions = parseResearchOpenOptions(options);
  return {
    siteId: validateResearchSiteId(siteId),
    url: validateResearchUrl(url).toString(),
    proxy: validateResearchProxy(proxy === undefined ? "" : proxy),
    ...(parsedOptions === undefined ? {} : { options: parsedOptions }),
  };
}

export function parseResearchNavigateInput(value: unknown): string | null {
  if (value === null) return null;
  return validateResearchUrl(value).toString();
}

export function parseResearchBounds(value: unknown): Bounds {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !["x", "y", "width", "height"].every((key) => Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !["x", "y", "width", "height"].includes(key))
  ) {
    throw new Error("Research view bounds are invalid");
  }
  const input = value as Record<string, unknown>;
  const x = requireResearchCoordinate(input.x, "x", -MAX_RESEARCH_BOUNDS_COORDINATE);
  const y = requireResearchCoordinate(input.y, "y", -MAX_RESEARCH_BOUNDS_COORDINATE);
  const width = requireResearchCoordinate(input.width, "width", 0, MAX_RESEARCH_BOUNDS_DIMENSION);
  const height = requireResearchCoordinate(
    input.height,
    "height",
    0,
    MAX_RESEARCH_BOUNDS_DIMENSION,
  );
  return { height, width, x, y };
}

function requireResearchCoordinate(
  value: unknown,
  label: string,
  minimum: number,
  maximum = MAX_RESEARCH_BOUNDS_COORDINATE,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Research view bound ${label} is invalid`);
  }
  return value as number;
}

function hasResearchControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function parseResearchSiteIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_RESEARCH_SITE_IDS) {
    throw new Error(`Research site ids are limited to ${MAX_RESEARCH_SITE_IDS}`);
  }
  const siteIds = Array.from(value, (candidate, index) => {
    try {
      return validateResearchSiteId(candidate);
    } catch {
      throw new Error(`Research site id at index ${index} is invalid`);
    }
  });
  if (new Set(siteIds).size !== siteIds.length) {
    throw new Error("Research site ids must be unique");
  }
  return siteIds;
}

export function isAllowedResearchUrl(rawUrl: unknown): boolean {
  try {
    validateResearchUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
