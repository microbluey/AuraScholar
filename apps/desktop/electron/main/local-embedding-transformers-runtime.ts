import { isAbsolute } from "node:path";
import type {
  LocalEmbeddingArtifact,
  LocalEmbeddingModelSpec,
  OfflineEmbeddingRuntime,
  OfflineEmbeddingRuntimeLoadInput,
  OfflineEmbeddingSession,
} from "./local-embedding-provider";

export const TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_ID = "transformers-js";
export const TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_VERSION = "3.8.1";

const MODEL_DTYPE = "q8";
const MODEL_FILE_NAME = "model";
const MODEL_SUBFOLDER = "onnx";

type TokenizerEncodeOptions = { readonly add_special_tokens?: boolean };
type TokenizerDecodeOptions = {
  readonly clean_up_tokenization_spaces?: boolean;
  readonly skip_special_tokens?: boolean;
};

export interface TransformersJsTokenizer {
  decode(tokenIds: readonly number[], options?: TokenizerDecodeOptions): string;
  encode(text: string, options?: TokenizerEncodeOptions): readonly number[];
}

export interface TransformersJsTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

export type TransformersJsFeatureExtractor = {
  (
    texts: string | readonly string[],
    options?: { readonly normalize?: boolean; readonly pooling?: "mean" },
  ): Promise<TransformersJsTensor>;
  readonly tokenizer: TransformersJsTokenizer;
};

export interface TransformersJsEnvironment {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  useBrowserCache: boolean;
  useCustomCache: boolean;
  useFS: boolean;
  useFSCache: boolean;
  readonly version: string;
}

export interface TransformersJsModule {
  readonly env: TransformersJsEnvironment;
  pipeline(
    task: "feature-extraction",
    model: string,
    options: {
      readonly device: "cpu";
      readonly dtype: "q8";
      readonly local_files_only: true;
      readonly model_file_name: "model";
      readonly revision: string;
      readonly subfolder: "onnx";
    },
  ): Promise<TransformersJsFeatureExtractor>;
}

export interface TransformersJsLocalEmbeddingRuntimeOptions {
  /** Injectable only to keep the main-process boundary independently testable. */
  importModule?: () => Promise<TransformersJsModule>;
}

/**
 * Transformers.js adapter for a catalog-installed ONNX artifact. It is loaded
 * lazily, disables every remote/cache path before resolving model files, and
 * passes an absolute local artifact directory to the runtime.
 */
export class TransformersJsLocalEmbeddingRuntime implements OfflineEmbeddingRuntime {
  readonly id = TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_ID;
  readonly version = TRANSFORMERS_JS_LOCAL_EMBEDDING_RUNTIME_VERSION;
  private readonly importModule: () => Promise<TransformersJsModule>;

  constructor(options: TransformersJsLocalEmbeddingRuntimeOptions = {}) {
    this.importModule = options.importModule ?? importTransformersJsModule;
  }

  async load(input: OfflineEmbeddingRuntimeLoadInput): Promise<OfflineEmbeddingSession> {
    assertRuntimeInput(input, this.id, this.version);
    const transformers = await this.importModule();
    configureOfflineEnvironment(transformers.env, this.version);
    const extractor = await transformers.pipeline("feature-extraction", input.artifact.rootDirectory, {
      device: "cpu",
      dtype: MODEL_DTYPE,
      local_files_only: true,
      model_file_name: MODEL_FILE_NAME,
      revision: input.artifact.modelRevision,
      subfolder: MODEL_SUBFOLDER,
    });
    assertFeatureExtractor(extractor);

    return new TransformersJsOfflineEmbeddingSession(extractor, input.model);
  }
}

class TransformersJsOfflineEmbeddingSession implements OfflineEmbeddingSession {
  constructor(
    private readonly extractor: TransformersJsFeatureExtractor,
    private readonly model: LocalEmbeddingModelSpec,
  ) {}

  async splitDocument(
    text: string,
    options: {
      maxContentTokens: number;
      overlapTokens: number;
      signal?: AbortSignal;
    },
  ): Promise<readonly string[]> {
    throwIfAborted(options.signal);
    assertText(text, "Embedding document");
    assertWindowOptions(options, this.model.maxContentTokens);

    const tokenIds = encodedTokenIds(this.extractor.tokenizer, text, false);
    if (tokenIds.length === 0) throw new Error("Embedding document did not produce tokens");
    const windows: string[] = [];
    const step = options.maxContentTokens - options.overlapTokens;
    for (let start = 0; start < tokenIds.length; start += step) {
      throwIfAborted(options.signal);
      const windowTokenIds = tokenIds.slice(start, start + options.maxContentTokens);
      const window = this.extractor.tokenizer
        .decode(windowTokenIds, {
          clean_up_tokenization_spaces: false,
          skip_special_tokens: true,
        })
        .trim();
      if (!window) throw new Error("Embedding tokenizer produced an empty document window");
      if (encodedTokenIds(this.extractor.tokenizer, window, false).length > options.maxContentTokens) {
        throw new Error("Embedding tokenizer window cannot be represented without truncation");
      }
      windows.push(window);
    }
    return windows;
  }

  async embed(
    texts: readonly string[],
    options: { maxSequenceTokens: number; signal?: AbortSignal },
  ): Promise<readonly Float32Array[]> {
    throwIfAborted(options.signal);
    if (!Array.isArray(texts)) throw new Error("Embedding texts must be an array");
    assertSequenceLimit(options.maxSequenceTokens, this.model.maxSequenceTokens);
    if (texts.length === 0) return [];

    for (const text of texts) {
      throwIfAborted(options.signal);
      assertText(text, "Embedding text");
      if (encodedTokenIds(this.extractor.tokenizer, text, true).length > options.maxSequenceTokens) {
        throw new Error("Embedding text exceeds the configured sequence limit");
      }
    }

    const output = await this.extractor(texts, { normalize: true, pooling: "mean" });
    throwIfAborted(options.signal);
    return toVectors(output, texts.length, this.model.dimension);
  }
}

async function importTransformersJsModule(): Promise<TransformersJsModule> {
  const transformers = await import("@huggingface/transformers");
  return {
    env: transformers.env as TransformersJsEnvironment,
    pipeline: transformers.pipeline as unknown as TransformersJsModule["pipeline"],
  };
}

function configureOfflineEnvironment(environment: TransformersJsEnvironment, version: string): void {
  if (environment.version !== version) {
    throw new Error("Installed Transformers.js runtime version does not match the model artifact");
  }
  // All values are assigned before the first pipeline construction. An absolute
  // local model path plus both flags prevents a missing artifact from falling
  // through to Hugging Face or to an ambient cache.
  environment.allowLocalModels = true;
  environment.allowRemoteModels = false;
  environment.useFS = true;
  environment.useBrowserCache = false;
  environment.useCustomCache = false;
  environment.useFSCache = false;
}

function assertRuntimeInput(
  input: OfflineEmbeddingRuntimeLoadInput,
  runtimeId: string,
  runtimeVersion: string,
): void {
  if (!input || typeof input !== "object") throw new Error("Local embedding runtime input is invalid");
  const { artifact, model } = input;
  if (!artifact || !model) throw new Error("Local embedding runtime input is incomplete");
  if (!isAbsolute(artifact.rootDirectory)) {
    throw new Error("Local embedding runtime requires an absolute artifact directory");
  }
  if (artifact.runtimeId !== runtimeId || artifact.runtimeVersion !== runtimeVersion) {
    throw new Error("Local embedding artifact does not match the Transformers.js runtime");
  }
  if (!Number.isSafeInteger(model.dimension) || model.dimension <= 0) {
    throw new Error("Local embedding model dimension is invalid");
  }
  if (!Number.isSafeInteger(model.maxSequenceTokens) || model.maxSequenceTokens <= 0) {
    throw new Error("Local embedding model sequence limit is invalid");
  }
  if (
    !Number.isSafeInteger(model.maxContentTokens) ||
    model.maxContentTokens <= 0 ||
    model.maxContentTokens > model.maxSequenceTokens
  ) {
    throw new Error("Local embedding model content limit is invalid");
  }
}

function assertFeatureExtractor(
  extractor: TransformersJsFeatureExtractor,
): asserts extractor is TransformersJsFeatureExtractor {
  if (typeof extractor !== "function" || !extractor.tokenizer) {
    throw new Error("Transformers.js feature extraction pipeline is invalid");
  }
  if (
    typeof extractor.tokenizer.encode !== "function" ||
    typeof extractor.tokenizer.decode !== "function"
  ) {
    throw new Error("Transformers.js tokenizer is invalid");
  }
}

function assertWindowOptions(
  options: { maxContentTokens: number; overlapTokens: number },
  modelMaxContentTokens: number,
): void {
  if (
    !Number.isSafeInteger(options.maxContentTokens) ||
    options.maxContentTokens <= 0 ||
    options.maxContentTokens > modelMaxContentTokens
  ) {
    throw new Error("Embedding document window limit is invalid");
  }
  if (
    !Number.isSafeInteger(options.overlapTokens) ||
    options.overlapTokens < 0 ||
    options.overlapTokens >= options.maxContentTokens
  ) {
    throw new Error("Embedding document window overlap is invalid");
  }
}

function assertSequenceLimit(maxSequenceTokens: number, modelMaxSequenceTokens: number): void {
  if (
    !Number.isSafeInteger(maxSequenceTokens) ||
    maxSequenceTokens <= 0 ||
    maxSequenceTokens > modelMaxSequenceTokens
  ) {
    throw new Error("Embedding sequence limit is invalid");
  }
}

function encodedTokenIds(
  tokenizer: TransformersJsTokenizer,
  text: string,
  addSpecialTokens: boolean,
): number[] {
  const tokenIds = tokenizer.encode(text, { add_special_tokens: addSpecialTokens });
  if (!Array.isArray(tokenIds) || tokenIds.some((tokenId) => !Number.isSafeInteger(tokenId))) {
    throw new Error("Embedding tokenizer returned invalid token identifiers");
  }
  return [...tokenIds];
}

function toVectors(
  output: TransformersJsTensor,
  expectedCount: number,
  expectedDimension: number,
): Float32Array[] {
  if (!output || typeof output !== "object" || !(output.data instanceof Float32Array)) {
    throw new Error("Transformers.js returned invalid embedding data");
  }
  if (
    !Array.isArray(output.dims) ||
    output.dims.length !== 2 ||
    output.dims[0] !== expectedCount ||
    output.dims[1] !== expectedDimension ||
    output.data.length !== expectedCount * expectedDimension
  ) {
    throw new Error("Transformers.js returned an unexpected embedding shape");
  }
  const vectors: Float32Array[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const offset = index * expectedDimension;
    const vector = output.data.slice(offset, offset + expectedDimension);
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Transformers.js returned a non-finite embedding value");
    }
    vectors.push(vector);
  }
  return vectors;
}

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must not be empty`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
