import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESULT_PREFIX = "AURASCHOLAR_SMOKE_RESULT ";
const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoDir = resolve(appDir, "..", "..");
const keepUserData = process.env.AURASCHOLAR_SMOKE_KEEP === "1";
const restoreNodeAbi = process.env.AURASCHOLAR_SMOKE_RESTORE_NODE_ABI !== "0";
const DEFAULT_RENDERER_SMOKE_TIMEOUT_MS = 120_000;
const parsedSmokeTimeoutMs = Number(
  process.env.AURASCHOLAR_SMOKE_TIMEOUT_MS ?? DEFAULT_RENDERER_SMOKE_TIMEOUT_MS,
);
const rendererSmokeTimeoutMs =
  Number.isFinite(parsedSmokeTimeoutMs) && parsedSmokeTimeoutMs > 0
    ? parsedSmokeTimeoutMs
    : DEFAULT_RENDERER_SMOKE_TIMEOUT_MS;
const smokeTimeoutMs = rendererSmokeTimeoutMs + 10_000;

function electronBinary() {
  const binaryName = process.platform === "win32" ? "electron.cmd" : "electron";
  const candidates = [
    join(appDir, "node_modules", ".bin", binaryName),
    join(appDir, "..", "..", "node_modules", ".bin", binaryName),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error(`Electron binary not found. Tried: ${candidates.join(", ")}`);
  }
  return match;
}

function parseResultLine(text) {
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(RESULT_PREFIX);
    if (index === -1) continue;
    return JSON.parse(line.slice(index + RESULT_PREFIX.length));
  }
  return null;
}

function printFailedChecks(result) {
  const failed = Array.isArray(result?.failed) ? result.failed : [];
  if (failed.length === 0) return;
  console.error("\nFailed smoke checks:");
  for (const check of failed) {
    console.error(`- ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  }
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoDir,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });
  return new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function restoreBetterSqliteForNode() {
  if (!restoreNodeAbi) return 0;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packageJson = require.resolve("better-sqlite3/package.json", {
    paths: [appDir, join(repoDir, "packages", "db")],
  });
  const env = { ...process.env };
  if (!env.npm_config_python && process.platform === "darwin" && existsSync("/usr/bin/python3")) {
    env.npm_config_python = "/usr/bin/python3";
  }
  console.log("Restoring better-sqlite3 for the current Node runtime...");
  return runCommand(npm, ["run", "build-release"], { cwd: dirname(packageJson), env });
}

const mainBundle = join(appDir, "out", "main", "main.js");
if (!existsSync(mainBundle)) {
  console.error("Desktop build output is missing. Run `pnpm --filter @aurascholar/desktop build` first.");
  process.exit(1);
}

const userDataDir = await mkdtemp(join(tmpdir(), "aurascholar-smoke-"));
let output = "";
let result = null;

const child = spawn(electronBinary(), ["."], {
  cwd: appDir,
  env: {
    ...process.env,
    AURASCHOLAR_SMOKE: "1",
    AURASCHOLAR_USER_DATA_DIR: userDataDir,
    ELECTRON_ENABLE_LOGGING: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  console.error(`Electron smoke timed out after ${Math.round(smokeTimeoutMs / 1000)}s.`);
}, smokeTimeoutMs);

const capture = (chunk, stream) => {
  const text = chunk.toString();
  output += text;
  stream.write(text);
  const parsed = parseResultLine(text);
  if (parsed) result = parsed;
};

child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
child.stderr.on("data", (chunk) => capture(chunk, process.stderr));

const exitCode = await new Promise((resolve) => {
  child.on("error", (error) => {
    console.error(error);
    resolve(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Electron smoke exited via ${signal}.`);
    resolve(code ?? 1);
  });
});

clearTimeout(timeout);
if (!keepUserData) {
  await rm(userDataDir, { force: true, recursive: true });
} else {
  console.log(`Smoke userData retained at ${userDataDir}`);
}

result ??= parseResultLine(output);
const restoreCode = await restoreBetterSqliteForNode();
if (!result) {
  console.error("Electron smoke did not emit a structured result.");
  process.exit(1);
}

printFailedChecks(result);
if (result.ok && exitCode === 0 && restoreCode === 0) {
  console.log("Electron smoke passed.");
  process.exit(0);
}

if (restoreCode !== 0) {
  console.error("Failed to restore better-sqlite3 for the current Node runtime.");
}

if (Array.isArray(result.consoleErrors) && result.consoleErrors.length > 0) {
  console.error("\nRenderer console errors:");
  for (const error of result.consoleErrors) console.error(`- ${error}`);
}

process.exit(1);
