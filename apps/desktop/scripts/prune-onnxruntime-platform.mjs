import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const ONNX_RUNTIME_NATIVE_ROOT = ["node_modules", "onnxruntime-node", "bin", "napi-v3"];

const ELECTRON_BUILDER_ARCH_NAMES = new Map([
  [0, "ia32"],
  [1, "x64"],
  [2, "armv7l"],
  [3, "arm64"],
  [4, "universal"],
]);

const SUPPORTED_ARCHITECTURES = new Set(["x64", "arm64"]);
const SUPPORTED_PLATFORMS = new Set(["darwin", "linux", "win32"]);

/**
 * Electron Builder invokes this after application files are staged but before
 * distributable/signing work. `onnxruntime-node` contains every supported
 * platform binary, so retain only the binary tree that can load in this target.
 *
 * It intentionally succeeds when the optional runtime is not a dependency yet.
 * Once it is present, an unknown target fails packaging rather than shipping an
 * application whose semantic-indexing runtime cannot load.
 */
export default async function pruneOnnxRuntimePlatform(context) {
  return pruneOnnxRuntimePlatformBinaries(context);
}

export async function pruneOnnxRuntimePlatformBinaries(context) {
  const nativeRoot = await findNativeRoot(context);
  if (nativeRoot === null) return { status: "not-installed" };

  const target = resolveTarget(context);
  const platformDirectory = join(nativeRoot, target.platform);
  const architectureDirectory = join(platformDirectory, target.architecture);

  if (!(await isDirectory(architectureDirectory))) {
    throw new Error(
      `onnxruntime-node does not provide ${target.platform}/${target.architecture} at ${architectureDirectory}`,
    );
  }

  const removed = [];
  for (const entry of await readdir(nativeRoot, { withFileTypes: true })) {
    const entryPath = join(nativeRoot, entry.name);
    if (entry.name !== target.platform) {
      await rm(entryPath, { force: true, recursive: true });
      removed.push(entry.name);
      continue;
    }

    if (!entry.isDirectory()) {
      throw new Error(`Expected ${platformDirectory} to be a directory`);
    }

    for (const architectureEntry of await readdir(platformDirectory, {
      withFileTypes: true,
    })) {
      if (architectureEntry.name === target.architecture) continue;
      await rm(join(platformDirectory, architectureEntry.name), {
        force: true,
        recursive: true,
      });
      removed.push(`${target.platform}/${architectureEntry.name}`);
    }
  }

  return {
    architectureDirectory,
    nativeRoot,
    removed,
    status: "pruned",
    target,
  };
}

export function resolveTarget(context) {
  const platform = context.electronPlatformName;
  const architecture =
    typeof context.arch === "string" ? context.arch : ELECTRON_BUILDER_ARCH_NAMES.get(context.arch);

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported onnxruntime-node platform: ${String(platform)}`);
  }
  if (!SUPPORTED_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported onnxruntime-node architecture: ${String(architecture)}`);
  }

  return { architecture, platform };
}

async function findNativeRoot(context) {
  for (const resourcesDirectory of resourceDirectories(context)) {
    const nativeRoot = join(resourcesDirectory, ...ONNX_RUNTIME_NATIVE_ROOT);
    if (await isDirectory(nativeRoot)) return nativeRoot;
  }
  return null;
}

function resourceDirectories(context) {
  const directories = [join(context.appOutDir, "resources", "app.asar.unpacked")];
  const productFilename = context.packager?.appInfo?.productFilename;
  if (typeof productFilename === "string" && productFilename.length > 0) {
    directories.push(
      join(
        context.appOutDir,
        `${productFilename}.app`,
        "Contents",
        "Resources",
        "app.asar.unpacked",
      ),
    );
  }
  return directories;
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
