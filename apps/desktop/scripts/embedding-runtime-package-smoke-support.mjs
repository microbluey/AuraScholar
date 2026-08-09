import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const EMBEDDING_RUNTIME_SMOKE_PREFIX = "AURASCHOLAR_EMBEDDING_RUNTIME_SMOKE ";

const ONNX_RUNTIME_NATIVE_ROOT = ["node_modules", "onnxruntime-node", "bin", "napi-v3"];

const PLATFORM_TARGET_FLAGS = {
  darwin: "mac",
  linux: "linux",
  win32: "win",
};

const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x64"]);

export function hostRuntimeTarget(platform = process.platform, architecture = process.arch) {
  if (!(platform in PLATFORM_TARGET_FLAGS)) {
    throw new Error(`Unsupported embedding-runtime smoke platform: ${platform}`);
  }
  if (!SUPPORTED_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported embedding-runtime smoke architecture: ${architecture}`);
  }
  return { architecture, platform };
}

export function electronBuilderTargetArgs(target) {
  return [
    "--dir",
    `--${PLATFORM_TARGET_FLAGS[target.platform]}`,
    `--${target.architecture}`,
    "--publish",
    "never",
  ];
}

export async function findPackagedExecutable(releaseDirectory, target, executableName) {
  const appOutDirectory = await findAppOutDirectory(releaseDirectory, target.platform);
  const executablePath =
    target.platform === "darwin"
      ? join(appOutDirectory, "Contents", "MacOS", executableName)
      : join(appOutDirectory, `${executableName}${target.platform === "win32" ? ".exe" : ""}`);
  if (!(await isFile(executablePath))) {
    throw new Error(`Packaged Electron executable was not found at ${executablePath}`);
  }
  return executablePath;
}

export async function findStagedOnnxRuntimeNativeRoot(releaseDirectory, target) {
  const appOutDirectory = await findAppOutDirectory(releaseDirectory, target.platform);
  const resourcesDirectory =
    target.platform === "darwin"
      ? join(appOutDirectory, "Contents", "Resources")
      : join(appOutDirectory, "resources");
  const nativeRoot = join(resourcesDirectory, "app.asar.unpacked", ...ONNX_RUNTIME_NATIVE_ROOT);
  if (!(await isDirectory(nativeRoot))) {
    throw new Error(`Staged onnxruntime-node binaries were not found at ${nativeRoot}`);
  }
  return nativeRoot;
}

export async function assertStagedOnnxRuntimeLayout(nativeRoot, target) {
  const platforms = await directoryNames(nativeRoot);
  assertExactDirectoryNames(
    platforms,
    [target.platform],
    `onnxruntime-node platforms at ${nativeRoot}`,
  );

  const platformDirectory = join(nativeRoot, target.platform);
  const architectures = await directoryNames(platformDirectory);
  assertExactDirectoryNames(
    architectures,
    [target.architecture],
    `onnxruntime-node architectures at ${platformDirectory}`,
  );

  const bindingPath = join(platformDirectory, target.architecture, "onnxruntime_binding.node");
  if (!(await isFile(bindingPath))) {
    throw new Error(`Expected target binding was not found at ${bindingPath}`);
  }

  return { bindingPath, nativeRoot, target };
}

export function parseEmbeddingRuntimeSmokeResult(output) {
  for (const line of output.split(/\r?\n/)) {
    const prefixIndex = line.indexOf(EMBEDDING_RUNTIME_SMOKE_PREFIX);
    if (prefixIndex === -1) continue;
    return JSON.parse(line.slice(prefixIndex + EMBEDDING_RUNTIME_SMOKE_PREFIX.length));
  }
  return null;
}

async function findAppOutDirectory(releaseDirectory, platform) {
  const releaseEntries = await readdir(releaseDirectory, { withFileTypes: true });
  if (platform === "darwin") {
    for (const entry of releaseEntries) {
      if (!entry.isDirectory()) continue;
      const candidateDirectory = join(releaseDirectory, entry.name);
      for (const candidate of await readdir(candidateDirectory, { withFileTypes: true })) {
        if (candidate.isDirectory() && candidate.name.endsWith(".app")) {
          return join(candidateDirectory, candidate.name);
        }
      }
    }
  } else {
    const expectedName = `${PLATFORM_TARGET_FLAGS[platform]}-unpacked`;
    const match = releaseEntries.find(
      (entry) => entry.isDirectory() && entry.name === expectedName,
    );
    if (match) return join(releaseDirectory, match.name);
  }
  throw new Error(`Could not find ${platform} app output under ${releaseDirectory}`);
}

async function directoryNames(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function assertExactDirectoryNames(actual, expected, description) {
  if (
    actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index])
  )
    return;
  throw new Error(
    `Expected only ${expected.join(", ")} in ${description}; found ${actual.join(", ") || "none"}`,
  );
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
