import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import { LOCAL_EMBEDDING_ARTIFACT_CATALOG } from "./local-embedding-artifact-catalog";
import { huggingFaceArtifactDownloadUrl } from "./local-embedding-artifact-downloader";
import { LocalEmbeddingArtifactInstaller } from "./local-embedding-artifact-installer";
import { TransformersJsLocalEmbeddingRuntime } from "./local-embedding-transformers-runtime";

const directories: string[] = [];
const networkSmoke = process.env.AURASCHOLAR_EMBEDDING_CURL_NETWORK_SMOKE === "1" ? it : it.skip;
const retainedArtifactRoot = process.env.AURASCHOLAR_EMBEDDING_CURL_NETWORK_SMOKE_ROOT?.trim();
const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;

afterEach(async () => {
  if (retainedArtifactRoot) return;
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

/**
 * Manual source-and-installer smoke for environments where Node's fetch cannot
 * establish a CDN connection. It is never part of normal tests or application
 * runtime; the production downloader remains fetch-based and independently
 * unit-tested above its private staging boundary.
 */
describe("local embedding artifact curl network smoke", () => {
  networkSmoke(
    "downloads the complete fixed artifact into private staging and lets the installer verify and publish it",
    async () => {
      const directory = retainedArtifactRoot
        ? null
        : await fs.mkdtemp(join(tmpdir(), "aurascholar-embedding-curl-smoke-"));
      if (directory) directories.push(directory);
      const installer = new LocalEmbeddingArtifactInstaller({
        rootDirectory: retainedArtifactRoot
          ? resolve(retainedArtifactRoot)
          : join(directory!, "models", "embedding"),
      });
      const catalogStatus = LOCAL_EMBEDDING_ARTIFACT_CATALOG.getStatus();
      if (catalogStatus.state !== "available") {
        throw new Error("Network smoke requires a complete embedding artifact catalog");
      }
      const acceptedLicenseAt = Date.now();
      const { plan, source } = LOCAL_EMBEDDING_ARTIFACT_CATALOG.createDownloadRequest({
        acceptedLicenseAt,
        acceptedLicenseId: catalogStatus.license.id,
        approvedDownloadAt: Math.max(acceptedLicenseAt, Date.now()),
      });
      const session = await installer.beginInstall(plan);
      try {
        for (const file of plan.manifest.files) {
          const target = join(session.artifactDirectory, ...file.path.split("/"));
          await fs.mkdir(dirname(target), { mode: 0o700, recursive: true });
          await downloadWithCurl(huggingFaceArtifactDownloadUrl(source, file.path), target);
        }

        const result = await installer.completeInstall(session);
        expect(result.summary).toMatchObject({
          fileCount: catalogStatus.artifact.fileCount,
          manifestSha256: catalogStatus.artifact.manifestSha256,
          modelRevision: catalogStatus.artifact.modelRevision,
          totalBytes: catalogStatus.artifact.totalBytes,
        });
        await expect(installer.inspect(model)).resolves.toMatchObject({
          artifact: expect.objectContaining({
            manifestSha256: catalogStatus.artifact.manifestSha256,
            totalBytes: catalogStatus.artifact.totalBytes,
          }),
          state: "ready",
        });

        const runtime = new TransformersJsLocalEmbeddingRuntime();
        const runtimeSession = await runtime.load({ artifact: result.artifact, model });
        const [vector] = await runtimeSession.embed(["query: durable local semantic retrieval"], {
          maxSequenceTokens: model.maxSequenceTokens,
        });
        expect(vector).toHaveLength(model.dimension);
        expect(vector?.every(Number.isFinite)).toBe(true);
        expect(l2Magnitude(vector!)).toBeCloseTo(1, 5);
      } catch (error) {
        await installer.abortInstall(session).catch(() => {});
        throw error;
      }
    },
    10 * 60_000,
  );
});

function downloadWithCurl(url: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      [
        "-sS",
        "-L",
        "-f",
        "--http1.1",
        "--retry",
        "4",
        "--retry-all-errors",
        "--retry-delay",
        "1",
        "-o",
        target,
        url,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`curl artifact download failed (${signal ?? code ?? "unknown"}): ${stderr}`),
      );
    });
  });
}

function l2Magnitude(vector: Float32Array): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}
