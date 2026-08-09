import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_EMBEDDING_MODEL_PRESETS,
  LocalEmbeddingProvider,
  type LocalEmbeddingArtifact,
  type OfflineEmbeddingRuntime,
  type OfflineEmbeddingSession,
} from "./local-embedding-provider";

const artifact: LocalEmbeddingArtifact = {
  manifestSha256: "a".repeat(64),
  modelRevision: "92e0ea7",
  rootDirectory: "/private/tmp/aurascholar-models/multilingual-e5-small",
  runtimeId: "test-onnx",
  runtimeVersion: "1.0.0",
};

describe("LocalEmbeddingProvider", () => {
  it("lazily loads a local runtime, prefixes queries, normalizes output, and records a reproducible profile", async () => {
    const session = sessionWithVectors([vector(3, 4)]);
    const runtime = runtimeWith(session);
    const provider = new LocalEmbeddingProvider({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
      runtime,
    });

    expect(runtime.load).not.toHaveBeenCalled();
    const queryVector = await provider.embedQuery("  grounded retrieval  ");
    expect(queryVector[0]).toBeCloseTo(0.6, 6);
    expect(queryVector[1]).toBeCloseTo(0.8, 6);
    expect(queryVector).toHaveLength(384);
    expect(runtime.load).toHaveBeenCalledWith({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
    });
    expect(session.embed).toHaveBeenCalledWith(["query: grounded retrieval"], {
      maxSequenceTokens: 512,
      signal: undefined,
    });
    expect(provider.egressMode).toBe("local");
    expect(provider.embeddingProfile).toMatchObject({
      chunkProfileVersion:
        "embedding-window-mean-v1:multilingual-e5-small-windowed-v1:tokens-448:overlap-64",
      dimension: 384,
      distanceMetric: "cosine",
      egressMode: "local",
      modelId: "intfloat/multilingual-e5-small",
      modelRevision: "Xenova/multilingual-e5-small@92e0ea7",
      normalization: "l2",
      providerKind: "local-test-onnx",
    });
    expect(provider.embeddingProfile.fingerprint).toContain(artifact.manifestSha256);
  });

  it("uses tokenizer-owned windows and L2 mean pooling instead of truncating a long document", async () => {
    const session: OfflineEmbeddingSession = {
      embed: vi.fn().mockResolvedValue([vector(1), vector(0, 1)]),
      splitDocument: vi.fn().mockResolvedValue(["first window", "second window"]),
    };
    const provider = new LocalEmbeddingProvider({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
      runtime: runtimeWith(session),
    });

    const vectors = await provider.embedDocuments(["A long source document"]);

    expect(session.splitDocument).toHaveBeenCalledWith("A long source document", {
      maxContentTokens: 448,
      overlapTokens: 64,
      signal: undefined,
    });
    expect(session.embed).toHaveBeenCalledWith(
      ["passage: first window", "passage: second window"],
      {
        maxSequenceTokens: 512,
        signal: undefined,
      },
    );
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(vectors[0]?.[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("fails closed without exposing a runtime error and permits a later retry", async () => {
    const session = sessionWithVectors([vector(1)]);
    const runtime = runtimeWith(session);
    runtime.load.mockRejectedValueOnce(new Error("private source title must not surface"));
    const provider = new LocalEmbeddingProvider({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
      runtime,
    });

    const failure = await provider.embedQuery("first request").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Local embedding model is unavailable");
    expect((failure as Error).message).not.toContain("private source title");
    await expect(provider.embedQuery("second request")).resolves.toMatchObject({
      0: 1,
      1: 0,
      length: 384,
    });
    expect(runtime.load).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-local artifact path before a runtime can receive user text", () => {
    const session = sessionWithVectors([vector(1)]);
    const runtime = runtimeWith(session);

    expect(
      () =>
        new LocalEmbeddingProvider({
          artifact: { ...artifact, rootDirectory: "https://models.example/multilingual-e5-small" },
          model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
          runtime,
        }),
    ).toThrow("absolute local path");
    expect(runtime.load).not.toHaveBeenCalled();
  });

  it("rejects an aborted request before loading a model or sending text to the runtime", async () => {
    const session = sessionWithVectors([vector(1)]);
    const runtime = runtimeWith(session);
    const provider = new LocalEmbeddingProvider({
      artifact,
      model: LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small,
      runtime,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.embedQuery("do not send", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(runtime.load).not.toHaveBeenCalled();
    expect(session.embed).not.toHaveBeenCalled();
  });
});

function runtimeWith(session: OfflineEmbeddingSession) {
  return {
    id: "test-onnx",
    load: vi.fn().mockResolvedValue(session),
    version: "1.0.0",
  } as OfflineEmbeddingRuntime & { load: ReturnType<typeof vi.fn> };
}

function sessionWithVectors(vectors: readonly Float32Array[]): OfflineEmbeddingSession {
  return {
    embed: vi.fn().mockResolvedValue(vectors),
    splitDocument: vi.fn().mockImplementation(async (text: string) => [text]),
  };
}

function vector(first: number, second = 0): Float32Array {
  const output = new Float32Array(384);
  output[0] = first;
  output[1] = second;
  return output;
}
