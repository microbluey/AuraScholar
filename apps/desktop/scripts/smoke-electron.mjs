import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createResultLineParser, parseResultLine } from "./smoke-result.mjs";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoDir = resolve(appDir, "..", "..");
const keepUserData = process.env.AURASCHOLAR_SMOKE_KEEP === "1";
const restoreNodeAbi = process.env.AURASCHOLAR_SMOKE_RESTORE_NODE_ABI !== "0";
const DEFAULT_RENDERER_SMOKE_TIMEOUT_MS = 300_000;
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

function electronAppBundle() {
  const packageJson = require.resolve("electron/package.json", { paths: [appDir, repoDir] });
  const bundle = join(dirname(packageJson), "dist", "Electron.app");
  if (!existsSync(bundle)) {
    throw new Error(`Electron app bundle not found at ${bundle}`);
  }
  return bundle;
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

async function readIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return "";
    throw error;
  }
}

async function launchViaMacLaunchServices(userDataDir) {
  const stdoutPath = join(userDataDir, "launchservices-stdout.log");
  const stderrPath = join(userDataDir, "launchservices-stderr.log");
  const openArgs = [
    "-n",
    "-W",
    "-g",
    "--stdout",
    stdoutPath,
    "--stderr",
    stderrPath,
    "--env",
    "AURASCHOLAR_SMOKE=1",
    "--env",
    `AURASCHOLAR_USER_DATA_DIR=${userDataDir}`,
    "--env",
    "ELECTRON_ENABLE_LOGGING=1",
  ];
  if (process.env.AURASCHOLAR_SMOKE_TIMEOUT_MS) {
    openArgs.push(
      "--env",
      `AURASCHOLAR_SMOKE_TIMEOUT_MS=${process.env.AURASCHOLAR_SMOKE_TIMEOUT_MS}`,
    );
  }
  openArgs.push(electronAppBundle(), "--args", appDir);

  const child = spawn("/usr/bin/open", openArgs, {
    cwd: repoDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let launcherOutput = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    launcherOutput += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    launcherOutput += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
  const [stdout, stderr] = await Promise.all([
    readIfPresent(stdoutPath),
    readIfPresent(stderrPath),
  ]);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return { exitCode, output: `${launcherOutput}${stdout}${stderr}` };
}

function shouldRetryViaMacLaunchServices({ exitCode, exitSignal, output, result }) {
  return (
    process.platform === "darwin" &&
    !result &&
    (exitSignal === "SIGABRT" ||
      (exitCode !== 0 &&
        /Electron(?:\.app)?(?:\/Contents\/MacOS\/Electron)? exited with signal SIGABRT/.test(
          output,
        )))
  );
}

const mainBundle = join(appDir, "out", "main", "main.js");
if (!existsSync(mainBundle)) {
  console.error(
    "Desktop build output is missing. Run `pnpm --filter @aurascholar/desktop build` first.",
  );
  process.exit(1);
}

const userDataDir = await mkdtemp(join(tmpdir(), "aurascholar-smoke-"));
let output = "";
let result = null;
const stdoutResultParser = createResultLineParser((parsed) => {
  result = parsed;
});
const stderrResultParser = createResultLineParser((parsed) => {
  result = parsed;
});

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

const capture = (chunk, stream, parser) => {
  const text = chunk.toString();
  output += text;
  stream.write(text);
  parser.push(text);
};

child.stdout.on("data", (chunk) => capture(chunk, process.stdout, stdoutResultParser));
child.stderr.on("data", (chunk) => capture(chunk, process.stderr, stderrResultParser));

let exitSignal = null;
let exitCode = await new Promise((resolve) => {
  child.on("error", (error) => {
    console.error(error);
    resolve(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Electron smoke exited via ${signal}.`);
    exitSignal = signal;
    resolve(code ?? 1);
  });
});

clearTimeout(timeout);
stdoutResultParser.flush();
stderrResultParser.flush();
if (shouldRetryViaMacLaunchServices({ exitCode, exitSignal, output, result })) {
  console.warn(
    "Electron smoke direct launch aborted before startup; retrying through macOS LaunchServices.",
  );
  const fallback = await launchViaMacLaunchServices(userDataDir);
  exitCode = fallback.exitCode;
  output += fallback.output;
  result ??= parseResultLine(fallback.output);
}
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
