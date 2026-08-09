import { describe, expect, it, vi } from "vitest";
import { LOCAL_EMBEDDING_MODEL_PRESETS } from "./local-embedding-provider";
import {
  getEmbeddingArtifactCatalogStatus,
  getEmbeddingArtifactStatus,
  installEmbeddingArtifact,
  removeEmbeddingArtifact,
  type EmbeddingArtifactCommandDependencies,
} from "./embedding-artifact-command-service";
import type {
  LocalEmbeddingArtifactCatalog,
  LocalEmbeddingArtifactCatalogStatus,
} from "./local-embedding-artifact-catalog";
import type { LocalEmbeddingArtifactInstallPlan } from "./local-embedding-artifact-installer";
import type {
  LocalEmbeddingArtifactInstaller,
  LocalEmbeddingArtifactStatus,
} from "./local-embedding-artifact-installer";

const model = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;

describe("embedding artifact commands", () => {
  it("reads only the catalog's safe availability summary", async () => {
    const getStatus = vi.fn().mockReturnValue(incompleteCatalogStatus());
    const catalog = catalogWith(getStatus);

    await expect(
      getEmbeddingArtifactCatalogStatus(dependenciesWith({ catalog })),
    ).resolves.toMatchObject({ state: "incomplete-manifest" });
    expect(getStatus).toHaveBeenCalledWith();
  });

  it("reads safe offline state from the fixed selected model", async () => {
    const inspect = vi.fn().mockResolvedValue({ state: "not-installed" } as const);
    const dependencies = dependenciesWith({ inspect });

    await expect(getEmbeddingArtifactStatus(dependencies)).resolves.toEqual({
      state: "not-installed",
    });
    expect(inspect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "multilingual-e5-small-windowed-v1" }),
    );
  });

  it("removes only the selected artifact and returns the post-removal status", async () => {
    const inspect = vi.fn().mockResolvedValue({ state: "not-installed" } as const);
    const uninstall = vi.fn().mockResolvedValue({ removed: true });
    const dependencies = dependenciesWith({ inspect, uninstall });

    await expect(removeEmbeddingArtifact(dependencies)).resolves.toEqual({
      removed: true,
      status: { state: "not-installed" },
    });
    expect(uninstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "multilingual-e5-small-windowed-v1" }),
    );
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it("keeps the install IPC closed before a full catalog manifest exists", async () => {
    const catalog = catalogWith(vi.fn().mockReturnValue(incompleteCatalogStatus()));
    const inspect = vi.fn();
    const downloadArtifact = vi.fn();

    await expect(
      installEmbeddingArtifact(dependenciesWith({ catalog, downloadArtifact, inspect })),
    ).rejects.toThrow("complete SHA-256 manifest");

    expect(catalog.createDownloadRequest).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(downloadArtifact).not.toHaveBeenCalled();
  });

  it("records trusted-clock consent and sends only the catalog plan/source to the downloader", async () => {
    const plan = {} as LocalEmbeddingArtifactInstallPlan;
    const source = {
      repositoryId: "Xenova/multilingual-e5-small",
      revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    } as const;
    const getStatus = vi.fn().mockReturnValue(availableCatalogStatus());
    const createDownloadRequest = vi.fn().mockReturnValue({ plan, source });
    const catalog = catalogWith(getStatus, createDownloadRequest);
    const installed = readyStatus();
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({ state: "not-installed" })
      .mockResolvedValue(installed);
    const downloadArtifact = vi.fn().mockResolvedValue(undefined);
    const now = vi.fn().mockReturnValueOnce(1_738_361_590_000).mockReturnValue(1_738_361_595_000);
    const dependencies = dependenciesWith({ catalog, downloadArtifact, inspect, now });

    await expect(installEmbeddingArtifact(dependencies)).resolves.toEqual({
      alreadyInstalled: false,
      status: installed,
    });

    expect(createDownloadRequest).toHaveBeenCalledWith({
      acceptedLicenseAt: 1_738_361_590_000,
      acceptedLicenseId: "mit",
      approvedDownloadAt: 1_738_361_595_000,
    });
    expect(downloadArtifact).toHaveBeenCalledWith({
      installer: expect.any(Object),
      plan,
      source,
    });
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("does not download again when the installed artifact already matches the catalog", async () => {
    const catalog = catalogWith(vi.fn().mockReturnValue(availableCatalogStatus()));
    const inspect = vi.fn().mockResolvedValue(readyStatus());
    const downloadArtifact = vi.fn();

    await expect(
      installEmbeddingArtifact(dependenciesWith({ catalog, downloadArtifact, inspect })),
    ).resolves.toEqual({ alreadyInstalled: true, status: readyStatus() });

    expect(catalog.createDownloadRequest).not.toHaveBeenCalled();
    expect(downloadArtifact).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
  });
});

function dependenciesWith({
  catalog = catalogWith(vi.fn().mockReturnValue(incompleteCatalogStatus())),
  downloadArtifact = vi.fn().mockResolvedValue(undefined),
  inspect = vi.fn().mockResolvedValue({ state: "not-installed" }),
  now = vi.fn().mockReturnValue(1_738_361_590_000),
  uninstall = vi.fn().mockResolvedValue({ removed: false }),
}: {
  catalog?: Pick<LocalEmbeddingArtifactCatalog, "createDownloadRequest" | "getStatus">;
  downloadArtifact?: ReturnType<typeof vi.fn>;
  inspect?: ReturnType<typeof vi.fn>;
  now?: ReturnType<typeof vi.fn>;
  uninstall?: ReturnType<typeof vi.fn>;
}): EmbeddingArtifactCommandDependencies {
  const installer = {
    abortInstall: vi.fn(),
    beginInstall: vi.fn(),
    completeInstall: vi.fn(),
    inspect,
    uninstall,
  } as unknown as LocalEmbeddingArtifactInstaller;
  return {
    downloadArtifact,
    getArtifactCatalog: () => catalog,
    getInstaller: () => installer,
    now,
  };
}

function catalogWith(
  getStatus: ReturnType<typeof vi.fn>,
  createDownloadRequest = vi.fn(),
): Pick<LocalEmbeddingArtifactCatalog, "createDownloadRequest" | "getStatus"> & {
  createDownloadRequest: ReturnType<typeof vi.fn>;
} {
  return { createDownloadRequest, getStatus } as Pick<
    LocalEmbeddingArtifactCatalog,
    "createDownloadRequest" | "getStatus"
  > & { createDownloadRequest: ReturnType<typeof vi.fn> };
}

function incompleteCatalogStatus(): LocalEmbeddingArtifactCatalogStatus {
  return {
    license: { id: "mit", label: "MIT License" },
    model: {
      artifactModelId: model.artifactModelId,
      id: model.id,
      sourceModelId: model.sourceModelId,
    },
    reason: "full-file-sha256-required",
    source: {
      repositoryId: "Xenova/multilingual-e5-small",
      revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    },
    state: "incomplete-manifest",
  };
}

function availableCatalogStatus(): LocalEmbeddingArtifactCatalogStatus {
  return {
    artifact: {
      fileCount: 4,
      manifestSha256: "a".repeat(64),
      modelRevision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
      totalBytes: 135_391_000,
    },
    license: { id: "mit", label: "MIT License" },
    model: {
      artifactModelId: model.artifactModelId,
      id: model.id,
      sourceModelId: model.sourceModelId,
    },
    source: {
      repositoryId: "Xenova/multilingual-e5-small",
      revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    },
    state: "available",
  };
}

function readyStatus(): LocalEmbeddingArtifactStatus {
  const catalog = availableCatalogStatus();
  if (catalog.state !== "available") throw new Error("Expected an available catalog status");
  return {
    artifact: {
      artifactModelId: model.artifactModelId,
      fileCount: catalog.artifact.fileCount,
      installedAt: 1_738_361_600_000,
      manifestSha256: catalog.artifact.manifestSha256,
      modelId: model.id,
      modelRevision: catalog.artifact.modelRevision,
      runtimeId: "transformers-js",
      runtimeVersion: "3.8.1",
      sourceModelId: model.sourceModelId,
      totalBytes: catalog.artifact.totalBytes,
    },
    state: "ready",
  };
}
