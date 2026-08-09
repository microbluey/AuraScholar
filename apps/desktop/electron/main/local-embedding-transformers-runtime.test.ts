import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_EMBEDDING_MODEL_PRESETS,
  type LocalEmbeddingArtifact,
} from "./local-embedding-provider";
import {
  TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_ID,
  TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_VERSION,
  TransformersJsLocalEmbeddingRuntime,
  type TransformersJsEnvironment,
  type TransformersJsFeatureExtractor,
  type TransformersJsModule,
  type TransformersJsTokenizer,
} from "./local-embedding-transformers-runtime";

const artifact: LocalEmbeddingArtifact = {
  manifestSha256: "a".repeat(64),
  modelRevision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  rootDirectory: "/private/tmp/aurascholar-models/multilingual-e5-small",
  runtimeId: TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_ID,
  runtimeVersion: TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_VERSION,
};

describe("TransformersJsLocalEmbeddingRuntime", () => {
  it("loads only the exact local q8 artifact and returns one copied vector per text", async () => {
    const tokenizer = characterTokenizer();
    const extractor = featureExtractor(tokenizer, {
      data: new Float32Array([1, 2, 3, 4, 5, 6]),
      dims: [2, 3],
    });
    const { environment, importModule, pipeline } = moduleWith(extractor);
    const runtime = new TransformersJsLocalEmbeddingRuntime({ importModule });

    const session = await runtime.load({
      artifact,
      model: { ...LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small, dimension: 3 },
    });
    const vectors = await session.embed(["query: alpha", "passage: beta"], {
      maxSequenceTokens: 512,
    });

    expect(environment).toMatchObject({
      allowLocalModels: true,
      allowRemoteModels: false,
      useBrowserCache: false,
      useCustomCache: false,
      useFS: true,
      useFSCache: false,
    });
    expect(pipeline).toHaveBeenCalledWith("feature-extraction", artifact.rootDirectory, {
      device: "cpu",
      dtype: "q8",
      local_files_only: true,
      model_file_name: "model",
      revision: artifact.modelRevision,
      subfolder: "onnx",
    });
    expect(extractor).toHaveBeenCalledWith(["query: alpha", "passage: beta"], {
      normalize: true,
      pooling: "mean",
    });
    expect(vectors).toEqual([new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])]);
    expect(vectors[0]).not.toBe(extractor.output.data);
  });

  it("splits with tokenizer token IDs and overlapping windows rather than character slicing", async () => {
    const extractor = featureExtractor(characterTokenizer(), {
      data: new Float32Array(384),
      dims: [1, 384],
    });
    const runtime = new TransformersJsLocalEmbeddingRuntime({
      importModule: moduleWith(extractor).importModule,
    });
    const session = await runtime.load({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
    });

    await expect(
      session.splitDocument("abcdefghij", { maxContentTokens: 4, overlapTokens: 1 }),
    ).resolves.toEqual(["abcd", "defg", "ghij", "j"]);
  });

  it("rejects an oversized input before the pipeline can silently truncate it", async () => {
    const tokenizer = characterTokenizer();
    const extractor = featureExtractor(tokenizer, {
      data: new Float32Array(384),
      dims: [1, 384],
    });
    const runtime = new TransformersJsLocalEmbeddingRuntime({
      importModule: moduleWith(extractor).importModule,
    });
    const session = await runtime.load({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
    });

    await expect(session.embed(["x".repeat(511)], { maxSequenceTokens: 512 })).rejects.toThrow(
      "exceeds the configured sequence limit",
    );
    expect(extractor).not.toHaveBeenCalled();
  });

  it("rejects a mismatched artifact before importing a runtime module", async () => {
    const importModule = vi.fn();
    const runtime = new TransformersJsLocalEmbeddingRuntime({ importModule });

    await expect(
      runtime.load({
        artifact: { ...artifact, runtimeVersion: "3.7.0" },
        model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
      }),
    ).rejects.toThrow("does not match the Transformers.js runtime");
    expect(importModule).not.toHaveBeenCalled();
  });

  it("fails closed when the runtime reports an unexpected vector shape", async () => {
    const extractor = featureExtractor(characterTokenizer(), {
      data: new Float32Array(383),
      dims: [1, 383],
    });
    const runtime = new TransformersJsLocalEmbeddingRuntime({
      importModule: moduleWith(extractor).importModule,
    });
    const session = await runtime.load({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
    });

    await expect(session.embed(["query: shape"], { maxSequenceTokens: 512 })).rejects.toThrow(
      "unexpected embedding shape",
    );
  });
});

function moduleWith(extractor: TransformersJsFeatureExtractor): {
  environment: TransformersJsEnvironment;
  importModule: () => Promise<TransformersJsModule>;
  pipeline: ReturnType<typeof vi.fn>;
} {
  const environment: TransformersJsEnvironment = {
    allowLocalModels: false,
    allowRemoteModels: true,
    useBrowserCache: true,
    useCustomCache: true,
    useFS: false,
    useFSCache: true,
    version: TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_VERSION,
  };
  const pipeline = vi.fn().mockResolvedValue(extractor);
  return {
    environment,
    importModule: async () => ({ env: environment, pipeline }),
    pipeline,
  };
}

function featureExtractor(
  tokenizer: TransformersJsTokenizer,
  output: { data: Float32Array; dims: readonly number[] },
): TransformersJsFeatureExtractor & { output: { data: Float32Array; dims: readonly number[] } } {
  const extractor = vi
    .fn()
    .mockResolvedValue(output) as unknown as TransformersJsFeatureExtractor & {
    output: { data: Float32Array; dims: readonly number[] };
  };
  Object.assign(extractor, { output, tokenizer });
  return extractor;
}

function characterTokenizer(): TransformersJsTokenizer {
  return {
    decode: (tokenIds) => String.fromCodePoint(...tokenIds),
    encode: (text, options) => {
      const content = [...text].map((character) => character.codePointAt(0) ?? 0);
      return options?.add_special_tokens ? [1, ...content, 2] : content;
    },
  };
}
