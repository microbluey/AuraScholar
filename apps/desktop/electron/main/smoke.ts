// Smoke-test harness (E2E in-app checks), main-process side. Loaded ONLY when
// AURASCHOLAR_SMOKE=1 via a dynamic import in main.ts, so it stays out of the
// normal startup path and ships as a separate lazy chunk.
// Driven by scripts/smoke-electron.mjs, which parses the JSON result line.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { buildSmokeChecks } from "./smoke/checks";
import type { CitationBridgeSmoke, SecretsFileSmoke, SmokeRendererResult } from "./smoke/contracts";
import { citationBridgePort } from "./citation-bridge";
import {
  SmokeInputDriver,
  SMOKE_INPUT_REQUEST_PREFIX,
  SMOKE_INPUT_RESULT_EVENT,
} from "./smoke/input-driver";
import { buildRendererSmokeScript } from "./smoke/renderer-script";
import { prepareSmokeWindowForLayout } from "./smoke/window-layout";

const SMOKE_MODE = process.env.AURASCHOLAR_SMOKE === "1";
const SMOKE_RESULT_PREFIX = "AURASCHOLAR_SMOKE_RESULT ";
const SMOKE_PROGRESS_PREFIX = "AURASCHOLAR_SMOKE_PROGRESS ";
const DEFAULT_SMOKE_TIMEOUT_MS = 300_000;
const parsedSmokeTimeoutMs = Number(
  process.env.AURASCHOLAR_SMOKE_TIMEOUT_MS ?? DEFAULT_SMOKE_TIMEOUT_MS,
);
const SMOKE_TIMEOUT_MS =
  Number.isFinite(parsedSmokeTimeoutMs) && parsedSmokeTimeoutMs > 0
    ? parsedSmokeTimeoutMs
    : DEFAULT_SMOKE_TIMEOUT_MS;
const CITATION_BRIDGE_READY_TIMEOUT_MS = 2_000;
const CITATION_BRIDGE_RETRY_INTERVAL_MS = 25;

function emitSmokeResult(result: unknown, code: 0 | 1): void {
  console.log(`${SMOKE_RESULT_PREFIX}${JSON.stringify(result)}`);
  setTimeout(() => app.exit(code), 50);
}

async function inspectSecretsFile(): Promise<SecretsFileSmoke> {
  const file = join(app.getPath("userData"), "secrets.json");
  try {
    const [info, raw] = await Promise.all([stat(file), readFile(file, "utf8")]);
    const modeBits = info.mode & 0o777;
    return {
      encryptedEncoding: raw.includes('"v1:') && !raw.includes('"raw:'),
      exists: true,
      mode: modeBits.toString(8).padStart(3, "0"),
      plaintextAbsent: !raw.includes("smoke-ai-busy-key"),
      privateMode: process.platform === "win32" || (modeBits & 0o077) === 0,
    };
  } catch (error) {
    return {
      encryptedEncoding: false,
      error: error instanceof Error ? error.message : String(error),
      exists: false,
      mode: "missing",
      plaintextAbsent: false,
      privateMode: false,
    };
  }
}

/**
 * Keep the local citation bridge's port main-owned. Smoke validates its HTTP
 * guard from the main process rather than exporting a renderer IPC just for
 * test discovery.
 */
async function inspectCitationBridge(): Promise<CitationBridgeSmoke> {
  const port = await waitForCitationBridgePort();
  if (port === null) return { methodGuard: false, pingOk: false, unauthRejected: false };

  try {
    const base = `http://127.0.0.1:${port}`;
    const [pingResponse, unauthResponse, methodResponse] = await Promise.all([
      fetch(`${base}/ping`),
      fetch(`${base}/works/search?q=smoke`),
      fetch(`${base}/ping`, { method: "POST" }),
    ]);
    const [pingJson, unauthJson, methodJson] = await Promise.all([
      readSmokeJson(pingResponse),
      readSmokeJson(unauthResponse),
      readSmokeJson(methodResponse),
    ]);
    return {
      pingOk:
        pingResponse.status === 200 &&
        pingJson?.ok === true &&
        pingJson.app === "aurascholar" &&
        pingResponse.headers.get("cache-control") === "no-store",
      unauthRejected: unauthResponse.status === 401 && unauthJson?.error === "bad token",
      methodGuard:
        methodResponse.status === 405 &&
        methodJson?.error === "method not allowed" &&
        (methodResponse.headers.get("allow") ?? "").includes("GET"),
    };
  } catch {
    return { methodGuard: false, pingOk: false, unauthRejected: false };
  }
}

async function readSmokeJson(response: Response): Promise<Record<string, unknown> | null> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function waitForCitationBridgePort(): Promise<number | null> {
  const deadline = Date.now() + CITATION_BRIDGE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const port = citationBridgePort();
    if (port !== null) return port;
    await new Promise<void>((resolve) => setTimeout(resolve, CITATION_BRIDGE_RETRY_INTERVAL_MS));
  }
  return citationBridgePort();
}

export function setupSmokeHarness(win: BrowserWindow): void {
  if (!SMOKE_MODE) return;

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const startedAt = Date.now();
  let lastProgress = "renderer-startup";
  let finished = false;
  const smokeInputDriver = new SmokeInputDriver(win);
  const timeout = setTimeout(() => {
    finish(
      {
        ok: false,
        reason: "timeout",
        elapsedMs: Date.now() - startedAt,
        lastProgress,
        consoleErrors,
        consoleWarnings,
      },
      1,
    );
  }, SMOKE_TIMEOUT_MS);

  function finish(result: unknown, code: 0 | 1): void {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    smokeInputDriver.dispose();
    emitSmokeResult(result, code);
  }

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (message.includes("AURASCHOLAR_SMOKE_ROUTE_CRASH")) return;
    if (message.startsWith(SMOKE_INPUT_REQUEST_PREFIX)) {
      void smokeInputDriver
        .enqueue(message)
        .then((requestId) => {
          if (!requestId || finished || win.webContents.isDestroyed()) return;
          return win.webContents.executeJavaScript(
            `window.dispatchEvent(new CustomEvent(${JSON.stringify(
              SMOKE_INPUT_RESULT_EVENT,
            )}, { detail: ${JSON.stringify({ id: requestId })} })); true;`,
            true,
          );
        })
        .catch((error: unknown) => {
          consoleErrors.push(
            `Smoke input driver failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return;
    }
    if (message.startsWith(SMOKE_PROGRESS_PREFIX)) {
      lastProgress = message.slice(SMOKE_PROGRESS_PREFIX.length).trim() || lastProgress;
      console.log(`${SMOKE_PROGRESS_PREFIX}${lastProgress}`);
      return;
    }
    const entry = `${message} (${sourceId}:${line})`;
    if (level >= 3) consoleErrors.push(entry);
    else if (level === 2) consoleWarnings.push(entry);
  });

  win.webContents.once("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    finish(
      {
        ok: false,
        reason: "did-fail-load",
        errorCode,
        errorDescription,
        validatedURL,
        consoleErrors,
        consoleWarnings,
      },
      1,
    );
  });

  let smokeStorageSeeded = false;

  win.webContents.on("did-finish-load", () => {
    if (!smokeStorageSeeded) {
      smokeStorageSeeded = true;
      void win.webContents
        .executeJavaScript(
          String.raw`
            try {
              localStorage.setItem("theme", "__aurascholar-invalid-theme__");
              localStorage.setItem("ai-settings", "{not-valid-json");
            } catch {}
            setTimeout(() => location.reload(), 0);
            true;
          `,
          true,
        )
        .catch((error: unknown) => {
          finish(
            {
              ok: false,
              reason: "smoke-storage-seed-failed",
              error: error instanceof Error ? error.message : String(error),
              consoleErrors,
              consoleWarnings,
            },
            1,
          );
        });
      return;
    }

    prepareSmokeWindowForLayout(win);
    const script = buildRendererSmokeScript();

    setTimeout(() => {
      win.webContents
        .executeJavaScript(script, true)
        .then(async (renderer: SmokeRendererResult) => {
          await smokeInputDriver.idle();
          const [secretsFile, citationBridge] = await Promise.all([
            inspectSecretsFile(),
            inspectCitationBridge(),
          ]);
          const checks = buildSmokeChecks(renderer, secretsFile, citationBridge);
          const failed = checks.filter((check) => !check.pass);
          const ok = failed.length === 0 && consoleErrors.length === 0;
          finish(
            {
              ok,
              checks,
              failed,
              elapsedMs: Date.now() - startedAt,
              lastProgress,
              consoleErrors,
              consoleWarnings,
              renderer: {
                hash: renderer.hash,
                heading: renderer.heading,
                title: renderer.title,
                workCount: renderer.seededWorkCount ?? renderer.initialWorkCount,
              },
            },
            ok ? 0 : 1,
          );
        })
        .catch((error: unknown) => {
          finish(
            {
              ok: false,
              reason: "execute-javascript-failed",
              error: error instanceof Error ? error.message : String(error),
              consoleErrors,
              consoleWarnings,
            },
            1,
          );
        });
    }, 250);
  });
}
