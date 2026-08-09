import { describe, expect, it } from "vitest";
import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import {
  canonicalLocalEmbeddingArtifactManifestSha256,
  type LocalEmbeddingArtifactManifest,
} from "./local-embedding-artifact-installer";
import {
  LOCAL_EMBEDDING_ARTIFACT_CATALOG,
  LocalEmbeddingArtifactCatalog,
} from "./local-embedding-artifact-catalog";

const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;
const source = {
  repositoryId: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
} as const;

describe("LocalEmbeddingArtifactCatalog", () => {
  it("pins the production candidate to a complete four-file immutable manifest", () => {
    const status = LOCAL_EMBEDDING_ARTIFACT_CATALOG.getStatus();
    expect(status).toEqual({
      artifact: {
        fileCount: 4,
        manifestSha256: "354ad9e76a40160b4fc5f86f15a9bba2114378c1f3b3c7ed3addc8e2c44db929",
        modelRevision: source.revision,
        totalBytes: 135_392_016,
      },
      license: { id: "mit", label: "MIT License" },
      model: {
        artifactModelId: "Xenova/multilingual-e5-small",
        id: "multilingual-e5-small-windowed-v1",
        sourceModelId: "intfloat/multilingual-e5-small",
      },
      source,
      state: "available",
    });
    if (status.state !== "available") throw new Error("Expected an available production catalog");
    const request = LOCAL_EMBEDDING_ARTIFACT_CATALOG.createDownloadRequest({
      acceptedLicenseAt: 1_738_361_590_000,
      acceptedLicenseId: "mit",
      approvedDownloadAt: 1_738_361_595_000,
    });
    expect(request.source).toEqual(source);
    expect(request.plan.manifestSha256).toBe(status.artifact.manifestSha256);
    expect(canonicalLocalEmbeddingArtifactManifestSha256(request.plan.manifest)).toBe(
      status.artifact.manifestSha256,
    );
    expect(request.plan.manifest.files).toEqual([
      {
        byteLength: 658,
        path: "config.json",
        sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
      },
      {
        byteLength: 118_308_185,
        path: "onnx/model_quantized.onnx",
        sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
      },
      {
        byteLength: 17_082_730,
        path: "tokenizer.json",
        sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
      },
      {
        byteLength: 443,
        path: "tokenizer_config.json",
        sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
      },
    ]);
  });

  it("keeps an incomplete catalog entry unable to create a downloader request", () => {
    const catalog = new LocalEmbeddingArtifactCatalog({
      license: { id: "mit", label: "MIT License" },
      model,
      source,
      state: "incomplete-manifest",
    });

    expect(() =>
      catalog.createDownloadRequest({
        acceptedLicenseAt: 1_738_361_590_000,
        acceptedLicenseId: "mit",
        approvedDownloadAt: 1_738_361_595_000,
      }),
    ).toThrow("complete SHA-256 manifest");
  });

  it("turns a complete, identity-matched record into the only plan/source pair for a downloader", () => {
    const manifest = manifestFor();
    const catalog = new LocalEmbeddingArtifactCatalog({
      license: { id: "mit", label: "MIT License" },
      manifest,
      manifestSha256: canonicalLocalEmbeddingArtifactManifestSha256(manifest),
      model,
      source,
      state: "available",
    });

    expect(catalog.getStatus()).toMatchObject({
      artifact: {
        fileCount: 2,
        manifestSha256: canonicalLocalEmbeddingArtifactManifestSha256(manifest),
        modelRevision: source.revision,
        totalBytes: 11,
      },
      state: "available",
    });
    expect(
      catalog.createDownloadRequest({
        acceptedLicenseAt: 1_738_361_590_000,
        acceptedLicenseId: "mit",
        approvedDownloadAt: 1_738_361_595_000,
      }),
    ).toEqual({
      plan: {
        consent: {
          acceptedLicenseAt: 1_738_361_590_000,
          acceptedLicenseId: "mit",
          approvedDownloadAt: 1_738_361_595_000,
        },
        license: { id: "mit", label: "MIT License" },
        manifest,
        manifestSha256: canonicalLocalEmbeddingArtifactManifestSha256(manifest),
        model,
      },
      source,
    });
  });

  it("rejects a record whose pinned digest, model, or source does not match the manifest", () => {
    const manifest = manifestFor();

    expect(
      () =>
        new LocalEmbeddingArtifactCatalog({
          license: { id: "mit", label: "MIT License" },
          manifest,
          manifestSha256: "a".repeat(64),
          model,
          source,
          state: "available",
        }),
    ).toThrow("pinned digest");
    expect(
      () =>
        new LocalEmbeddingArtifactCatalog({
          license: { id: "mit", label: "MIT License" },
          manifest,
          manifestSha256: canonicalLocalEmbeddingArtifactManifestSha256(manifest),
          model,
          source: { ...source, revision: "b".repeat(40) },
          state: "available",
        }),
    ).toThrow("manifest does not match its source");
  });
});

function manifestFor(): LocalEmbeddingArtifactManifest {
  return {
    artifactModelId: model.artifactModelId,
    files: [
      { byteLength: 5, path: "config.json", sha256: "a".repeat(64) },
      { byteLength: 6, path: "onnx/model_quantized.onnx", sha256: "b".repeat(64) },
    ],
    modelId: model.id,
    modelRevision: source.revision,
    runtimeId: "transformers-js",
    runtimeVersion: "3.8.1",
    schemaVersion: 1,
    sourceModelId: model.sourceModelId,
  };
}
