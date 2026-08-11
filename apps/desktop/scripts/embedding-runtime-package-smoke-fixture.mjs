export const EMBEDDING_RUNTIME_SMOKE_TRANSFORMERS_VERSION = "3.8.1";
export const EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION = "0.35.3";

/**
 * Manifest for the disposable package used to verify the packaged embedding
 * runtime. Keep sharp overridden here: this fixture is installed by npm in a
 * temporary directory and does not inherit the workspace pnpm override.
 */
export function createEmbeddingRuntimeSmokeFixturePackage({
  afterPack,
  electronVersion,
  executableName,
}) {
  return {
    name: "aurascholar-embedding-runtime-smoke",
    version: "0.0.0",
    private: true,
    type: "module",
    main: "main.mjs",
    dependencies: {
      "@huggingface/transformers": EMBEDDING_RUNTIME_SMOKE_TRANSFORMERS_VERSION,
    },
    overrides: {
      sharp: EMBEDDING_RUNTIME_SMOKE_SHARP_VERSION,
    },
    devDependencies: {
      electron: electronVersion,
    },
    build: {
      appId: "app.aurascholar.embedding-runtime-smoke",
      productName: "AuraScholar Embedding Runtime Smoke",
      executableName,
      electronVersion,
      directories: {
        output: "release",
      },
      files: ["**/*"],
      asar: true,
      asarUnpack: ["node_modules/onnxruntime-node/**/*"],
      npmRebuild: true,
      afterPack,
    },
  };
}
