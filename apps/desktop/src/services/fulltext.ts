import { newId } from "@aurascholar/db/ids";

export interface FulltextLandingTarget {
  arxivId?: string | null;
  doi?: string | null;
  id: string;
  title: string;
  url?: string | null;
}

export type FulltextTaskOrigin = "reader" | "library" | "discovery";
export type FulltextReturnOrigin = Exclude<FulltextTaskOrigin, "discovery">;
export type FulltextReturnPath = `/${FulltextReturnOrigin}?work=${string}`;

export interface FulltextTaskOptions {
  handoffId?: string | null;
  origin?: FulltextTaskOrigin | null;
  returnTo?: string | null;
}

/**
 * One immutable "find full text for this work" intent.
 *
 * `targetTabId` is deliberately not serialized into the route. Discovery binds
 * it after opening the research tab, so a later download cannot inherit the
 * target of whichever handoff happens to be active at completion time.
 */
export interface FulltextTask {
  arxivId?: string;
  doi?: string;
  handoffId?: string;
  id: string;
  landingUrl: string;
  origin?: FulltextTaskOrigin;
  returnTo?: FulltextReturnPath;
  targetTabId?: string;
  title: string;
  url?: string;
}

function encodeUrlPath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function optionalHttpUrl(value: string | null | undefined): string | undefined {
  const candidate = optionalText(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function taskOrigin(value: string | null | undefined): FulltextTaskOrigin | undefined {
  return value === "reader" || value === "library" || value === "discovery" ? value : undefined;
}

export function fulltextLandingUrl(target: FulltextLandingTarget): string {
  const arxivId = target.arxivId?.trim();
  if (arxivId) return `https://arxiv.org/abs/${encodeUrlPath(arxivId)}`;
  const doi = target.doi?.trim();
  if (doi) return `https://doi.org/${encodeUrlPath(doi)}`;
  const url = optionalHttpUrl(target.url);
  if (url) return url;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(target.title)}`;
}

export function fulltextReturnPath(
  destination: FulltextReturnOrigin,
  workId: string,
): FulltextReturnPath {
  const params = new URLSearchParams({ work: workId });
  return `/${destination}?${params.toString()}` as FulltextReturnPath;
}

/**
 * Accepts only an AuraScholar reader/library route for the same work. This is a
 * runtime boundary because route query parameters are untrusted even when the
 * TypeScript caller used `FulltextReturnPath`.
 */
export function normalizeFulltextReturnPath(
  value: string | null | undefined,
  workId: string,
): FulltextReturnPath | undefined {
  const candidate = optionalText(value);
  if (!candidate || (!candidate.startsWith("/reader?") && !candidate.startsWith("/library?"))) {
    return undefined;
  }
  try {
    const parsed = new URL(candidate, "https://aurascholar.local");
    const destination =
      parsed.pathname === "/reader" ? "reader" : parsed.pathname === "/library" ? "library" : null;
    if (
      !destination ||
      parsed.origin !== "https://aurascholar.local" ||
      parsed.hash ||
      parsed.searchParams.getAll("work").length !== 1 ||
      Array.from(parsed.searchParams.keys()).some((key) => key !== "work") ||
      parsed.searchParams.get("work") !== workId
    ) {
      return undefined;
    }
    return fulltextReturnPath(destination, workId);
  } catch {
    return undefined;
  }
}

export function createFulltextTask(
  target: FulltextLandingTarget,
  options: FulltextTaskOptions = {},
): FulltextTask {
  const id = target.id.trim();
  const title = target.title.trim();
  const arxivId = optionalText(target.arxivId);
  const doi = optionalText(target.doi);
  const url = optionalHttpUrl(target.url);
  const task: FulltextTask = {
    id,
    landingUrl: fulltextLandingUrl({ arxivId, doi, id, title, url }),
    title,
  };
  const handoffId = optionalText(options.handoffId);
  const origin = taskOrigin(options.origin);
  const returnTo = normalizeFulltextReturnPath(options.returnTo, id);
  if (arxivId) task.arxivId = arxivId;
  if (doi) task.doi = doi;
  if (handoffId) task.handoffId = handoffId;
  if (origin) task.origin = origin;
  if (returnTo) task.returnTo = returnTo;
  if (url) task.url = url;
  return task;
}

export function bindFulltextTaskToTab(task: FulltextTask, targetTabId: string): FulltextTask {
  const normalizedTabId = targetTabId.trim();
  if (!normalizedTabId) throw new Error("Full-text task requires a target tab id");
  if (task.targetTabId && task.targetTabId !== normalizedTabId) {
    throw new Error("Full-text task is already bound to another tab");
  }
  return task.targetTabId ? task : { ...task, targetTabId: normalizedTabId };
}

export function fulltextHandoffPath(
  target: FulltextLandingTarget,
  options: FulltextTaskOptions = {},
): string {
  const task = createFulltextTask(target, options);
  const params = new URLSearchParams({
    pendingWorkId: task.id,
    pendingTitle: task.title,
    landingUrl: task.landingUrl,
    url: task.url ?? task.landingUrl,
  });
  if (task.arxivId) params.set("arxivId", task.arxivId);
  if (task.doi) params.set("doi", task.doi);
  if (task.handoffId) params.set("handoffId", task.handoffId);
  if (task.origin) params.set("origin", task.origin);
  if (task.returnTo) params.set("returnTo", task.returnTo);
  return `/discovery?${params.toString()}`;
}

/** Builds a uniquely identified recovery task that returns to the originating work. */
export function fulltextWorkHandoffPath(
  target: FulltextLandingTarget,
  origin: FulltextReturnOrigin,
): string {
  return fulltextHandoffPath(target, {
    handoffId: newId(),
    origin,
    returnTo: fulltextReturnPath(origin, target.id),
  });
}

function fulltextSearchParams(input: URLSearchParams | string): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  const queryIndex = input.indexOf("?");
  return new URLSearchParams(queryIndex >= 0 ? input.slice(queryIndex + 1) : input);
}

/**
 * Parses both the new task contract and the legacy pendingWorkId/pendingTitle
 * handoff. Unknown metadata is ignored; an unsafe return route is never exposed
 * to the caller.
 */
export function parseFulltextTask(input: URLSearchParams | string): FulltextTask | null {
  const params = fulltextSearchParams(input);
  const id = optionalText(params.get("pendingWorkId"));
  const title = optionalText(params.get("pendingTitle"));
  if (!id || !title) return null;
  return createFulltextTask(
    {
      arxivId: optionalText(params.get("arxivId")),
      doi: optionalText(params.get("doi")),
      id,
      title,
      url: optionalHttpUrl(params.get("url")),
    },
    {
      handoffId: params.get("handoffId"),
      origin: taskOrigin(params.get("origin")),
      returnTo: params.get("returnTo"),
    },
  );
}

/** useState-friendly initializer kept separate so Discovery owns no URL parsing. */
export function initialFulltextTask(input: URLSearchParams | string): FulltextTask | null {
  return parseFulltextTask(input);
}
