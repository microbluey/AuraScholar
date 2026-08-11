import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmbeddingRuntimeSmokeFixturePackage,
  EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION,
  EMBEDDING_RUNTIME_SMOKE_TRANSFORMERS_VERSION,
} from "./embedding-runtime-package-smoke-fixture.mjs";

test("embedding runtime package fixture pins the patched sharp release", () => {
  const fixture = createEmbeddingRuntimeSmokeFixturePackage({
    afterPack: "/fixture/prune-onnxruntime-platform.mjs",
    electronVersion: "33.4.11",
    executableName: "embedding-runtime-smoke",
  });

  assert.equal(
    fixture.dependencies["@huggingface/transformers"],
    EMBEDDING_RUNTIME_SMOKE_TRANSFORMERS_VERSION,
  );
  assert.deepEqual(fixture.overrides, { sharp: EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION });
  assert.equal(fixture.overrides.sharp, "0.35.3");
  assert.equal(fixture.build.afterPack, "/fixture/prune-onnxruntime-platform.mjs");
});
