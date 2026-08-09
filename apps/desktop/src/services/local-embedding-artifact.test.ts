import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalEmbeddingArtifactCatalogStatus,
  getLocalEmbeddingArtifactStatus,
  installLocalEmbeddingArtifact,
  removeLocalEmbeddingArtifact,
} from "./local-embedding-artifact";

describe("local embedding artifact desktop gateway", () => {
  const artifactStatus = vi.fn();
  const artifactCatalogStatus = vi.fn();
  const installArtifact = vi.fn();
  const removeArtifact = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        aura: {
          embedding: { artifactCatalogStatus, artifactStatus, installArtifact, removeArtifact },
        },
      },
    });
  });

  it("reads the safe main-process artifact status without accepting renderer input", async () => {
    artifactStatus.mockResolvedValue({ state: "not-installed" });

    await expect(getLocalEmbeddingArtifactStatus()).resolves.toEqual({ state: "not-installed" });
    expect(artifactStatus).toHaveBeenCalledWith();
  });

  it("reads catalog availability without receiving a manifest, path, or download input", async () => {
    artifactCatalogStatus.mockResolvedValue({ state: "incomplete-manifest" });

    await expect(getLocalEmbeddingArtifactCatalogStatus()).resolves.toEqual({
      state: "incomplete-manifest",
    });
    expect(artifactCatalogStatus).toHaveBeenCalledWith();
  });

  it("requests removal through the fixed-model bridge", async () => {
    removeArtifact.mockResolvedValue({ removed: true, status: { state: "not-installed" } });

    await expect(removeLocalEmbeddingArtifact()).resolves.toEqual({
      removed: true,
      status: { state: "not-installed" },
    });
    expect(removeArtifact).toHaveBeenCalledWith();
  });

  it("requests installation through the fixed-model bridge without renderer-provided paths or URLs", async () => {
    installArtifact.mockResolvedValue({
      alreadyInstalled: false,
      status: { state: "not-installed" },
    });

    await expect(installLocalEmbeddingArtifact()).resolves.toEqual({
      alreadyInstalled: false,
      status: { state: "not-installed" },
    });
    expect(installArtifact).toHaveBeenCalledWith();
  });
});
