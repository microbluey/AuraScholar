import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import {
  canonicalLocalEmbeddingArtifactManifestSha256,
  LocalEmbeddingArtifactInstaller,
  type LocalEmbeddingArtifactInstallPlan,
  type LocalEmbeddingArtifactManifest,
} from "./local-embedding-artifact-installer";
import {
  downloadAndInstallLocalEmbeddingArtifact,
  huggingFaceArtifactDownloadUrl,
  MAX_LOCAL_EMBEDDING_ARTIFACT_RESPONSE_BYTES,
  type LocalEmbeddingArtifactFetchResponse,
} from "./local-embedding-artifact-downloader";

const directories: string[] = [];
const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;
const source = {
  repositoryId: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
} as const;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("local embedding artifact downloader", () => {
  it("streams each catalog-pinned file into the private stage and publishes only after verification", async () => {
    const installer = await createInstaller();
    const files: Record<string, Uint8Array> = {
      "config.json": bytes("config"),
      "onnx/model_quantized.onnx": bytes("quantized-model"),
      "tokenizer.json": bytes("tokenizer"),
    };
    const plan = planFor(files);
    const progress: unknown[] = [];
    const fetch = vi.fn(async (url: string) => response(files[filePathFromUrl(url)]));

    const result = await downloadAndInstallLocalEmbeddingArtifact(
      {
        installer,
        onProgress: (update) => progress.push(update),
        plan,
        source,
      },
      { fetch },
    );

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith(
      huggingFaceArtifactDownloadUrl(source, "onnx/model_quantized.onnx"),
      { headers: { Range: "bytes=0-14" }, signal: undefined },
    );
    expect(progress.at(-1)).toEqual({
      completedBytes: totalBytes(files),
      fileCount: 3,
      fileIndex: 2,
      filePath: "tokenizer.json",
      totalBytes: totalBytes(files),
    });
    await expect(installer.inspect(model)).resolves.toEqual({
      artifact: expect.objectContaining({ fileCount: 3, modelRevision: source.revision }),
      state: "ready",
    });
    expect(
      await fs.readFile(join(result.artifact.rootDirectory, "onnx/model_quantized.onnx")),
    ).toEqual(Buffer.from(files["onnx/model_quantized.onnx"]!));
  });

  it("uses bounded Range responses for a large file while preserving its full-file digest", async () => {
    const installer = await createInstaller();
    const modelBytes = new Uint8Array(MAX_LOCAL_EMBEDDING_ARTIFACT_RESPONSE_BYTES + 17).map(
      (_value, index) => index % 251,
    );
    const files = { "onnx/model_quantized.onnx": modelBytes };
    const plan = planFor(files);
    const fetch = vi.fn(async (_url: string, options: { headers: Record<string, string> }) => {
      const range = options.headers.Range;
      if (!range) throw new Error("Expected a Range request");
      const [start, end] = parseRange(range);
      return response(modelBytes.slice(start, end + 1));
    });

    await downloadAndInstallLocalEmbeddingArtifact({ installer, plan, source }, { fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([_url, options]) => options.headers.Range)).toEqual([
      `bytes=0-${MAX_LOCAL_EMBEDDING_ARTIFACT_RESPONSE_BYTES - 1}`,
      `bytes=${MAX_LOCAL_EMBEDDING_ARTIFACT_RESPONSE_BYTES}-${modelBytes.byteLength - 1}`,
    ]);
    await expect(installer.inspect(model)).resolves.toEqual({
      artifact: expect.objectContaining({ totalBytes: modelBytes.byteLength }),
      state: "ready",
    });
  });

  it("retries a transient transport failure with the same fixed Range request", async () => {
    const installer = await createInstaller();
    const files = { "onnx/model_quantized.onnx": bytes("model") };
    const plan = planFor(files);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockResolvedValueOnce(response(files["onnx/model_quantized.onnx"]));

    await downloadAndInstallLocalEmbeddingArtifact({ installer, plan, source }, { fetch });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([_url, options]) => options.headers.Range)).toEqual([
      "bytes=0-4",
      "bytes=0-4",
    ]);
  });

  it("does not retry a permanent HTTP failure", async () => {
    const installer = await createInstaller();
    const plan = planFor({ "onnx/model_quantized.onnx": bytes("model") });
    const fetch = vi.fn().mockResolvedValue({ body: null, ok: false, status: 404 });

    await expect(
      downloadAndInstallLocalEmbeddingArtifact({ installer, plan, source }, { fetch }),
    ).rejects.toThrow("HTTP 404");

    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(installer.inspect(model)).resolves.toEqual({ state: "not-installed" });
  });

  it("aborts the stage when a response fails its manifest digest", async () => {
    const installer = await createInstaller();
    const files = { "onnx/model_quantized.onnx": bytes("model-a") };
    const plan = planFor(files);
    const fetch = vi.fn(async () => response(bytes("model-b")));

    await expect(
      downloadAndInstallLocalEmbeddingArtifact({ installer, plan, source }, { fetch }),
    ).rejects.toThrow("digest");
    await expect(installer.inspect(model)).resolves.toEqual({ state: "not-installed" });
  });

  it("rejects a moving revision or unsafe path before it can create a download URL", () => {
    expect(() =>
      huggingFaceArtifactDownloadUrl({ ...source, revision: "main" }, "config.json"),
    ).toThrow("immutable Git commit");
    expect(() => huggingFaceArtifactDownloadUrl(source, "../config.json")).toThrow("file path");
    expect(() => huggingFaceArtifactDownloadUrl(source, "onnx\\model.onnx")).toThrow("file path");
  });

  it("requires the catalog manifest and Hugging Face source to name the same immutable artifact", async () => {
    const installer = await createInstaller();
    const fetch = vi.fn();
    const plan = planFor({ "model.onnx": bytes("model") });

    await expect(
      downloadAndInstallLocalEmbeddingArtifact(
        {
          installer,
          plan,
          source: { ...source, repositoryId: "Xenova/another-model" },
        },
        { fetch },
      ),
    ).rejects.toThrow("manifest repository");
    await expect(
      downloadAndInstallLocalEmbeddingArtifact(
        {
          installer,
          plan,
          source: { ...source, revision: "b".repeat(40) },
        },
        { fetch },
      ),
    ).rejects.toThrow("manifest revision");

    expect(fetch).not.toHaveBeenCalled();
    await expect(installer.inspect(model)).resolves.toEqual({ state: "not-installed" });
  });

  it("does not create a staging session when its caller has already aborted", async () => {
    const installer = await createInstaller();
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();

    await expect(
      downloadAndInstallLocalEmbeddingArtifact(
        {
          installer,
          plan: planFor({ "model.onnx": bytes("model") }),
          signal: controller.signal,
          source,
        },
        { fetch },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(installer.inspect(model)).resolves.toEqual({ state: "not-installed" });
  });
});

async function createInstaller() {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-embedding-download-"));
  directories.push(directory);
  return new LocalEmbeddingArtifactInstaller({
    now: () => 1_738_361_600_000,
    rootDirectory: join(directory, "models", "embedding"),
  });
}

function planFor(files: Record<string, Uint8Array>): LocalEmbeddingArtifactInstallPlan {
  const manifest: LocalEmbeddingArtifactManifest = {
    artifactModelId: model.artifactModelId,
    files: Object.entries(files).map(([path, value]) => ({
      byteLength: value.byteLength,
      path,
      sha256: sha256(value),
    })),
    modelId: model.id,
    modelRevision: source.revision,
    runtimeId: "transformers-js",
    runtimeVersion: "3.8.1",
    schemaVersion: 1,
    sourceModelId: model.sourceModelId,
  };
  return {
    consent: {
      acceptedLicenseAt: 1_738_361_590_000,
      acceptedLicenseId: "mit",
      approvedDownloadAt: 1_738_361_595_000,
    },
    license: { id: "mit", label: "MIT License" },
    manifest,
    manifestSha256: canonicalLocalEmbeddingArtifactManifestSha256(manifest),
    model,
  };
}

function response(value: Uint8Array | undefined): LocalEmbeddingArtifactFetchResponse {
  if (!value) return { body: null, ok: false, status: 404 };
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const midpoint = Math.max(1, Math.floor(value.byteLength / 2));
        controller.enqueue(value.slice(0, midpoint));
        controller.enqueue(value.slice(midpoint));
        controller.close();
      },
    }),
    ok: true,
    status: 200,
  };
}

function filePathFromUrl(url: string): string {
  const marker = `/resolve/${source.revision}/`;
  const path = new URL(url).pathname;
  const start = path.indexOf(marker);
  if (start < 0) throw new Error("unexpected test URL");
  return decodeURIComponent(path.slice(start + marker.length));
}

function parseRange(value: string): [number, number] {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value);
  if (!match) throw new Error("Unexpected Range header");
  return [Number(match[1]), Number(match[2])];
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function totalBytes(files: Record<string, Uint8Array>): number {
  return Object.values(files).reduce((total, value) => total + value.byteLength, 0);
}
