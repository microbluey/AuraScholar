#!/usr/bin/env node
/**
 * Builds and starts a disposable, model-free Electron package with the optional
 * local embedding runtime. It deliberately installs packages outside the repo
 * and never fetches a model artifact. Intended for native CI runners only.
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertStagedOnnxRuntimeLayout,
  electronBuilderTargetArgs,
  EMBEDDING_RUNTIME_SMOKE_PREFIX,
  findPackagedExecutable,
  findStagedOnnxRuntimeNativeRoot,
  hostRuntimeTarget,
  parseEmbeddingRuntimeSmokeResult,
} from "./embedding-runtime-package-smoke-support.mjs";
import {
  createEmbeddingRuntimeSmokeFixturePackage,
  EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION,
} from "./embedding-runtime-package-smoke-fixture.mjs";

const EXECUTABLE_NAME = "aurascholar-embedding-runtime-smoke";
const keepFixture = process.env.AURASCHOLAR_EMBEDDING_SMOKE_KEEP === "1";
const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const target = hostRuntimeTarget();
const fixtureRoot = await mkdtemp(join(tmpdir(), "aurascholar-embedding-runtime-smoke-"));
const releaseDirectory = join(fixtureRoot, "release");

try {
  const electronVersion = await installedElectronVersion();
  await writeFixture(electronVersion);
  await installFixtureDependencies();
  await assertInstalledFixtureSharpVersion();
  await packageFixture();

  const nativeRoot = await findStagedOnnxRuntimeNativeRoot(releaseDirectory, target);
  const layout = await assertStagedOnnxRuntimeLayout(nativeRoot, target);
  const executable = await findPackagedExecutable(releaseDirectory, target, EXECUTABLE_NAME);
  const launch = await launchPackagedSmoke(executable);
  const result = parseEmbeddingRuntimeSmokeResult(`${launch.stdout}\n${launch.stderr}`);

  if (launch.exitCode !== 0) {
    throw new Error(
      `Packaged embedding runtime smoke exited with ${launch.exitCode}: ${launch.stderr}`,
    );
  }
  if (!result?.hasInferenceSession || !result.remoteDisabled) {
    throw new Error(
      `Packaged embedding runtime smoke did not prove offline loading: ${launch.stdout}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        electronVersion,
        layout,
        result,
        target,
      },
      null,
      2,
    ),
  );
} finally {
  if (keepFixture) console.error(`Embedding runtime smoke fixture retained at ${fixtureRoot}`);
  else await rm(fixtureRoot, { force: true, recursive: true });
}

async function installedElectronVersion() {
  const electronPackageJson = require.resolve("electron/package.json", { paths: [appDirectory] });
  const electronPackage = JSON.parse(await readFile(electronPackageJson, "utf8"));
  if (typeof electronPackage.version !== "string") {
    throw new Error(`Electron package at ${electronPackageJson} has no version`);
  }
  return electronPackage.version;
}

async function writeFixture(electronVersion) {
  await writeFile(
    join(fixtureRoot, "package.json"),
    JSON.stringify(
      createEmbeddingRuntimeSmokeFixturePackage({
        afterPack: join(appDirectory, "scripts", "prune-onnxruntime-platform.mjs"),
        electronVersion,
        executableName: EXECUTABLE_NAME,
      }),
      null,
      2,
    ),
  );
  await writeFile(join(fixtureRoot, "main.mjs"), packagedMainSource());
}

async function installFixtureDependencies() {
  await runCommand(npmCommand(), ["install", "--no-audit", "--no-fund", "--package-lock=false"], {
    cwd: fixtureRoot,
    stdio: "inherit",
  });
}

async function assertInstalledFixtureSharpVersion() {
  const sharpEntry = require.resolve("sharp", { paths: [fixtureRoot] });
  const sharpPackageJsonPath = join(dirname(dirname(sharpEntry)), "package.json");
  const sharpPackage = JSON.parse(await readFile(sharpPackageJsonPath, "utf8"));
  if (sharpPackage.version !== EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION) {
    throw new Error(
      `Embedding runtime smoke expected sharp ${EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION}, received ${String(sharpPackage.version)}`,
    );
  }
}

async function packageFixture() {
  await runCommand(electronBuilderBinary(), electronBuilderTargetArgs(target), {
    cwd: fixtureRoot,
    stdio: "inherit",
  });
}

async function launchPackagedSmoke(executable) {
  const launch =
    target.platform === "linux"
      ? { args: ["--auto-servernum", executable, "--disable-gpu"], command: "xvfb-run" }
      : { args: ["--disable-gpu"], command: executable };
  return runCommand(launch.command, launch.args, { cwd: fixtureRoot, stdio: "pipe" });
}

function packagedMainSource() {
  return `import { app } from "electron";
import { env, pipeline } from "@huggingface/transformers";
import { join } from "node:path";

const prefix = ${JSON.stringify(EMBEDDING_RUNTIME_SMOKE_PREFIX)};

async function run() {
  await app.whenReady();
  const runtime = await import("onnxruntime-node");
  env.allowRemoteModels = false;
  env.useFSCache = false;
  env.localModelPath = join(process.resourcesPath, "missing-local-model");

  let failure = "";
  try {
    await pipeline("feature-extraction", "model-is-not-installed");
  } catch (error) {
    failure = String(error instanceof Error ? error.message : error);
  }

  const result = {
    hasInferenceSession: typeof runtime.InferenceSession === "function",
    remoteDisabled: failure.includes("env.allowRemoteModels=false"),
  };
  console.log(prefix + JSON.stringify(result));
  app.exit(result.hasInferenceSession && result.remoteDisabled ? 0 : 1);
}

void run().catch((error) => {
  console.error(String(error instanceof Error ? error.stack ?? error.message : error));
  app.exit(1);
});
`;
}

function electronBuilderBinary() {
  const binaryName = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
  const binaryPath = join(appDirectory, "node_modules", ".bin", binaryName);
  if (!existsSync(binaryPath))
    throw new Error(`Electron Builder binary was not found at ${binaryPath}`);
  return binaryPath;
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runCommand(command, argumentsList, { cwd, stdio }) {
  const child = spawn(command, argumentsList, { cwd, stdio });
  const stdout = [];
  const stderr = [];
  if (stdio === "pipe") {
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
  }

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
  const output = {
    exitCode,
    stderr: Buffer.concat(stderr).toString(),
    stdout: Buffer.concat(stdout).toString(),
  };
  if (exitCode !== 0 && stdio !== "pipe") {
    throw new Error(`${command} ${argumentsList.join(" ")} failed with exit code ${exitCode}`);
  }
  return output;
}
