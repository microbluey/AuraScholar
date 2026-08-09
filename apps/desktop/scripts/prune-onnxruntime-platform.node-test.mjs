import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pruneOnnxRuntimePlatformBinaries, resolveTarget } from "./prune-onnxruntime-platform.mjs";

const TARGETS = {
  darwin: ["arm64", "x64"],
  linux: ["arm64", "x64"],
  win32: ["arm64", "x64"],
};

describe("onnxruntime target-aware packaging hook", () => {
  it("accepts Electron Builder's numeric architecture values", () => {
    assert.deepEqual(resolveTarget({ arch: 3, electronPlatformName: "darwin" }), {
      architecture: "arm64",
      platform: "darwin",
    });
    assert.deepEqual(resolveTarget({ arch: 1, electronPlatformName: "win32" }), {
      architecture: "x64",
      platform: "win32",
    });
  });

  it("is a safe no-op while the optional runtime is not installed", async (t) => {
    const appOutDir = await createAppDirectory(t, { includeRuntime: false });

    await assert.doesNotReject(() =>
      pruneOnnxRuntimePlatformBinaries({ appOutDir, arch: 4, electronPlatformName: "darwin" }),
    );
    assert.deepEqual(
      await pruneOnnxRuntimePlatformBinaries({
        appOutDir,
        arch: 4,
        electronPlatformName: "darwin",
      }),
      { status: "not-installed" },
    );
  });

  it("keeps only the current macOS arm64 runtime tree in an app bundle", async (t) => {
    const appOutDir = await createAppDirectory(t, { macBundle: true });
    const nativeRoot = nativeRootForMacBundle(appOutDir);

    const result = await pruneOnnxRuntimePlatformBinaries({
      appOutDir,
      arch: 3,
      electronPlatformName: "darwin",
      packager: { appInfo: { productFilename: "AuraScholar" } },
    });

    assert.equal(result.status, "pruned");
    await assertPathExists(join(nativeRoot, "darwin", "arm64", "binding.node"));
    await assertPathMissing(join(nativeRoot, "darwin", "x64"));
    await assertPathMissing(join(nativeRoot, "linux"));
    await assertPathMissing(join(nativeRoot, "win32"));
  });

  it("keeps only the target Windows x64 tree", async (t) => {
    const appOutDir = await createAppDirectory(t);
    const nativeRoot = nativeRootForStandardLayout(appOutDir);

    await pruneOnnxRuntimePlatformBinaries({
      appOutDir,
      arch: "x64",
      electronPlatformName: "win32",
    });

    await assertPathExists(join(nativeRoot, "win32", "x64", "binding.node"));
    await assertPathMissing(join(nativeRoot, "win32", "arm64"));
    await assertPathMissing(join(nativeRoot, "darwin"));
    await assertPathMissing(join(nativeRoot, "linux"));
  });

  it("fails closed if the selected target binary is absent", async (t) => {
    const appOutDir = await createAppDirectory(t);
    const nativeRoot = nativeRootForStandardLayout(appOutDir);
    await rm(join(nativeRoot, "linux", "arm64"), { force: true, recursive: true });

    await assert.rejects(
      () =>
        pruneOnnxRuntimePlatformBinaries({
          appOutDir,
          arch: 3,
          electronPlatformName: "linux",
        }),
      /does not provide linux\/arm64/,
    );
  });
});

async function createAppDirectory(t, { includeRuntime = true, macBundle = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aurascholar-onnx-packaging-"));
  t.after(() => rm(root, { force: true, recursive: true }));

  const appOutDir = join(root, "app-out");
  const nativeRoot = macBundle
    ? nativeRootForMacBundle(appOutDir)
    : nativeRootForStandardLayout(appOutDir);
  if (!includeRuntime) return appOutDir;

  for (const [platform, architectures] of Object.entries(TARGETS)) {
    for (const architecture of architectures) {
      const binaryDirectory = join(nativeRoot, platform, architecture);
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(join(binaryDirectory, "binding.node"), `${platform}/${architecture}`);
    }
  }
  return appOutDir;
}

function nativeRootForStandardLayout(appOutDir) {
  return join(
    appOutDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v3",
  );
}

function nativeRootForMacBundle(appOutDir) {
  return join(
    appOutDir,
    "AuraScholar.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v3",
  );
}

async function assertPathExists(path) {
  await access(path);
}

async function assertPathMissing(path) {
  await assert.rejects(() => access(path));
}
