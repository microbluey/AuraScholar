import { Notification } from "electron";
import type { ResolvedWork } from "@aurascholar/core";
import type { ConnectorContext } from "@aurascholar/connectors";
import type { Database } from "@aurascholar/db";
import { requireLocalLibraryId } from "@aurascholar/db/local-first";
import { assertActiveLocalLibrary } from "./data-command-runtime";
import { resolveScholarlyClue } from "./scholarly-commands";
import { mainScholarlyHttp } from "./scholarly-http";
import type { MainSentinelNotifier } from "./sentinel-runner-serialization";

/**
 * The context injects the per-run AbortSignal even though some legacy core
 * helpers do not yet accept a signal parameter themselves. That keeps all
 * connector retries, rate-limit waits, and fetches cancellable without a
 * renderer HTTP bridge.
 */
export function createMainSentinelConnectorContext(signal: AbortSignal): ConnectorContext {
  return {
    http: {
      request: (request) => mainScholarlyHttp.request({ ...request, signal }),
    },
    mailto: "contact@aurascholar.app",
  };
}

/** Direct main-only resolver used after a durable state transition. */
export function resolveMainSentinelAutoIngest(
  doi: string,
  signal: AbortSignal,
): Promise<ResolvedWork | null> {
  return resolveScholarlyClue({ doi, kind: "doi" }, signal);
}

export const mainSentinelNotifier: MainSentinelNotifier = {
  async notify(notification): Promise<void> {
    if (Notification.isSupported()) {
      new Notification({ body: notification.body, title: notification.title }).show();
    }
  },
};

export async function assertActiveSentinelLibrary(
  database: Database,
  libraryId: string,
): Promise<void> {
  // Keep both checks explicit: `requireLocalLibraryId` derives the durable
  // identity, while `assertActiveLocalLibrary` rejects a deleted/stale scope.
  const durableLibraryId = await requireLocalLibraryId(database);
  await assertActiveLocalLibrary(database, libraryId);
  if (durableLibraryId !== libraryId) throw new Error("Rejected stale or foreign Library scope");
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function abortError(): Error {
  const error = new Error("Sentinel request cancelled");
  error.name = "AbortError";
  return error;
}
