import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import { LOCAL_EMBEDDING_ARTIFACT_CATALOG } from "./local-embedding-artifact-catalog";
import { downloadAndInstallLocalEmbeddingArtifact } from "./local-embedding-artifact-downloader";
import { LocalEmbeddingArtifactInstaller } from "./local-embedding-artifact-installer";

const directories: string[] = [];
const networkSmoke = process.env.AURASCHOLAR_EMBEDDING_NETWORK_SMOKE === "1" ? it : it.skip;
const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("local embedding artifact network smoke", () => {
  networkSmoke(
    "downloads the exact catalog-pinned artifact to a disposable root and publishes only after verification",
    async () => {
      const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-embedding-network-smoke-"));
      directories.push(directory);
      const installer = new LocalEmbeddingArtifactInstaller({
        rootDirectory: join(directory, "models", "embedding"),
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

      const result = await downloadAndInstallLocalEmbeddingArtifact({ installer, plan, source });

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
    },
    10 * 60_000,
  );
});
