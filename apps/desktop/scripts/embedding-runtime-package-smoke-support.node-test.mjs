import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertStagedOnnxRuntimeLayout,
  electronBuilderTargetArgs,
  EMBEDDING_RUNTIME_SMOKE_PREFIX,
  findPackagedExecutable,
  findStagedOnnxRuntimeNativeRoot,
  hostRuntimeTarget,
  parseEmbeddingRuntimeSmokeResult,
} from "./embedding-runtime-package-smoke-support.mjs";

describe("embedding runtime package smoke support", () => {
  it("maps native targets to Electron Builder arguments", () => {
    assert.deepEqual(hostRuntimeTarget("darwin", "arm64"), {
      architecture: "arm64",
      platform: "darwin",
    });
    assert.deepEqual(electronBuilderTargetArgs({ architecture: "x64", platform: "win32" }), [
      "--dir",
      "--win",
      "--x64",
      "--publish",
      "never",
    ]);
    assert.throws(
      () => hostRuntimeTarget("linux", "ia32"),
      /Unsupported embedding-runtime smoke architecture/,
    );
  });

  it("finds and validates a staged Windows package with only one runtime target", async (t) => {
    const fixture = await createFixture(t, { platform: "win32" });
    const target = { architecture: "x64", platform: "win32" };

    const nativeRoot = await findStagedOnnxRuntimeNativeRoot(fixture.releaseDirectory, target);
    const executable = await findPackagedExecutable(
      fixture.releaseDirectory,
      target,
      fixture.executableName,
    );

    assert.deepEqual(await assertStagedOnnxRuntimeLayout(nativeRoot, target), {
      bindingPath: join(nativeRoot, "win32", "x64", "onnxruntime_binding.node"),
      nativeRoot,
      target,
    });
    assert.equal(executable, join(fixture.appOutDirectory, `${fixture.executableName}.exe`));
  });

  it("rejects an unpacked runtime with an extra platform tree", async (t) => {
    const fixture = await createFixture(t, { platform: "linux" });
    const target = { architecture: "x64", platform: "linux" };
    const nativeRoot = await findStagedOnnxRuntimeNativeRoot(fixture.releaseDirectory, target);
    await mkdir(join(nativeRoot, "win32", "x64"), { recursive: true });

    await assert.rejects(
      () => assertStagedOnnxRuntimeLayout(nativeRoot, target),
      /Expected only linux/,
    );
  });

  it("parses the structured result from mixed Electron output", () => {
    const result = { hasInferenceSession: true, remoteDisabled: true };
    assert.deepEqual(
      parseEmbeddingRuntimeSmokeResult(
        `noise\n${EMBEDDING_RUNTIME_SMOKE_PREFIX}${JSON.stringify(result)}\n`,
      ),
      result,
    );
    assert.equal(parseEmbeddingRuntimeSmokeResult("no structured result"), null);
  });
});

async function createFixture(t, { platform }) {
  const root = await mkdtemp(join(tmpdir(), "aurascholar-embedding-package-smoke-"));
  t.after(() => rm(root, { force: true, recursive: true }));

  const executableName = "embedding-runtime-smoke";
  const targetDirectoryName =
    platform === "darwin" ? "mac-arm64" : `${platform === "win32" ? "win" : platform}-unpacked`;
  const appOutDirectory =
    platform === "darwin"
      ? join(root, "release", targetDirectoryName, "AuraScholar.app")
      : join(root, "release", targetDirectoryName);
  const resourcesDirectory =
    platform === "darwin"
      ? join(appOutDirectory, "Contents", "Resources")
      : join(appOutDirectory, "resources");
  const executablePath =
    platform === "darwin"
      ? join(appOutDirectory, "Contents", "MacOS", executableName)
      : join(appOutDirectory, `${executableName}${platform === "win32" ? ".exe" : ""}`);
  const nativeRoot = join(
    resourcesDirectory,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v3",
  );
  const targetPlatform = platform;
  await mkdir(join(nativeRoot, targetPlatform, "x64"), { recursive: true });
  await writeFile(join(nativeRoot, targetPlatform, "x64", "onnxruntime_binding.node"), "binding");
  await mkdir(join(executablePath, ".."), { recursive: true });
  await writeFile(executablePath, "executable");

  return {
    appOutDirectory,
    executableName,
    releaseDirectory: join(root, "release"),
  };
}
