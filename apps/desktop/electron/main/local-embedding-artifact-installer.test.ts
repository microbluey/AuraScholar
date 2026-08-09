import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import {
  canonicalLocalEmbeddingArtifactManifestSha256,
  LocalEmbeddingArtifactInstaller,
  type LocalEmbeddingArtifactInstallPlan,
  type LocalEmbeddingArtifactInstallSession,
  type LocalEmbeddingArtifactManifest,
} from "./local-embedding-artifact-installer";

const directories: string[] = [];
const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("LocalEmbeddingArtifactInstaller", () => {
  it("publishes only a consented, manifest-verified artifact and hides its path from status", async () => {
    const installer = await createInstaller();
    const files = {
      "config.json": bytes('{"model":"multilingual-e5-small"}'),
      "onnx/model.onnx": bytes("verified-model-bytes"),
      "tokenizer.json": bytes('{"tokenizer":"e5"}'),
    };
    const session = await installer.beginInstall(planFor(files));
    await writeStage(session, files);

    const result = await installer.completeInstall(session);
    const status = await installer.inspect(model);

    expect(status).toEqual({
      artifact: expect.objectContaining({
        fileCount: 3,
        modelId: model.id,
        modelRevision: "revision-a",
        runtimeId: "transformers-js",
        runtimeVersion: "3.8.1",
        totalBytes: totalBytes(files),
      }),
      state: "ready",
    });
    expect(JSON.stringify(status)).not.toContain(result.artifact.rootDirectory);
    expect(status).not.toHaveProperty("rootDirectory");
    expect(
      new Uint8Array(await fs.readFile(join(result.artifact.rootDirectory, "onnx/model.onnx"))),
    ).toEqual(files["onnx/model.onnx"]);
    await expect(installer.getInstalledArtifact(model)).resolves.toEqual(result.artifact);
  });

  it("rejects a manifest whose pinned digest or total size does not fit the trusted policy", async () => {
    const files = { "model.onnx": bytes("model") };
    const invalidDigest = { ...planFor(files), manifestSha256: "0".repeat(64) };
    const digestInstaller = await createInstaller();
    await expect(digestInstaller.beginInstall(invalidDigest)).rejects.toThrow("pinned digest");

    const invalidConsent = {
      ...planFor(files),
      consent: {
        acceptedLicenseAt: 20,
        acceptedLicenseId: "mit",
        approvedDownloadAt: 10,
      },
    };
    await expect(digestInstaller.beginInstall(invalidConsent)).rejects.toThrow("predates license");

    const quotaInstaller = await createInstaller({ maxArtifactBytes: totalBytes(files) - 1 });
    await expect(quotaInstaller.beginInstall(planFor(files))).rejects.toThrow("disk quota");
  });

  it("does not publish a partial or modified staging directory", async () => {
    const installer = await createInstaller();
    const files = {
      "config.json": bytes("configuration"),
      "model.onnx": bytes("expected-model"),
    };
    const session = await installer.beginInstall(planFor(files));
    await writeStage(session, { ...files, "model.onnx": bytes("tampered-model") });

    await expect(installer.completeInstall(session)).rejects.toThrow("file-hash-mismatch");
    await expect(installer.inspect(model)).resolves.toEqual({ state: "not-installed" });
    await installer.abortInstall(session);
  });

  it("detects files added after installation, denies runtime access, and safely removes the artifact", async () => {
    const installer = await createInstaller();
    const files = { "model.onnx": bytes("verified-model") };
    const session = await installer.beginInstall(planFor(files));
    await writeStage(session, files);
    const result = await installer.completeInstall(session);
    await fs.writeFile(join(result.artifact.rootDirectory, "unexpected.bin"), bytes("unexpected"));

    await expect(installer.inspect(model)).resolves.toEqual({
      reason: "unexpected-entry",
      state: "corrupt",
    });
    await expect(installer.getInstalledArtifact(model)).resolves.toBeNull();
    await expect(installer.uninstall(model)).resolves.toEqual({ removed: true });
    await expect(installer.inspect(model)).resolves.toEqual({ state: "not-installed" });
  });

  it("replaces an earlier verified revision only after the new revision verifies", async () => {
    const installer = await createInstaller();
    const firstFiles = { "model.onnx": bytes("revision-one") };
    const firstSession = await installer.beginInstall(
      planFor(firstFiles, { revision: "revision-a" }),
    );
    await writeStage(firstSession, firstFiles);
    const first = await installer.completeInstall(firstSession);

    const secondFiles = { "model.onnx": bytes("revision-two") };
    const secondSession = await installer.beginInstall(
      planFor(secondFiles, { revision: "revision-b" }),
    );
    await writeStage(secondSession, secondFiles);
    const second = await installer.completeInstall(secondSession);

    expect(second.artifact.rootDirectory).toBe(first.artifact.rootDirectory);
    expect(
      new Uint8Array(await fs.readFile(join(second.artifact.rootDirectory, "model.onnx"))),
    ).toEqual(secondFiles["model.onnx"]);
    await expect(installer.inspect(model)).resolves.toEqual({
      artifact: expect.objectContaining({ modelRevision: "revision-b" }),
      state: "ready",
    });
  });
});

async function createInstaller(options: { maxArtifactBytes?: number } = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-embedding-artifact-"));
  directories.push(directory);
  return new LocalEmbeddingArtifactInstaller({
    ...options,
    now: () => 1_738_361_600_000,
    rootDirectory: join(directory, "models", "embedding"),
  });
}

function planFor(
  files: Record<string, Uint8Array>,
  options: { revision?: string } = {},
): LocalEmbeddingArtifactInstallPlan {
  const manifest: LocalEmbeddingArtifactManifest = {
    artifactModelId: model.artifactModelId,
    files: Object.entries(files).map(([path, value]) => ({
      byteLength: value.byteLength,
      path,
      sha256: sha256(value),
    })),
    modelId: model.id,
    modelRevision: options.revision ?? "revision-a",
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
    license: {
      id: "mit",
      label: "MIT License",
      url: "https://opensource.org/license/mit",
    },
    manifest,
    manifestSha256: canonicalLocalEmbeddingArtifactManifestSha256(manifest),
    model,
  };
}

async function writeStage(
  session: LocalEmbeddingArtifactInstallSession,
  files: Record<string, Uint8Array>,
): Promise<void> {
  for (const [path, value] of Object.entries(files)) {
    const target = join(session.artifactDirectory, ...path.split("/"));
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, value);
  }
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
