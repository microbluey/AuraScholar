import {
  LOCAL_EMBEDDING_MODEL_PRESETS,
  type LocalEmbeddingModelSpec,
} from "./local-embedding-provider";
import type { HuggingFaceArtifactSource } from "./local-embedding-artifact-downloader";
import {
  canonicalLocalEmbeddingArtifactManifestSha256,
  type LocalEmbeddingArtifactInstallConsent,
  type LocalEmbeddingArtifactInstallPlan,
  type LocalEmbeddingArtifactLicense,
  type LocalEmbeddingArtifactManifest,
} from "./local-embedding-artifact-installer";

const HUGGING_FACE_REPOSITORY_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const GIT_COMMIT_SHA = /^[a-f0-9]{40}$/;

export interface LocalEmbeddingArtifactCatalogModelSummary {
  readonly artifactModelId: string;
  readonly id: string;
  readonly sourceModelId: string;
}

/** Safe read-only state that may cross the preload boundary. */
export type LocalEmbeddingArtifactCatalogStatus =
  | {
      readonly license: LocalEmbeddingArtifactLicense;
      readonly model: LocalEmbeddingArtifactCatalogModelSummary;
      readonly reason: "full-file-sha256-required";
      readonly source: HuggingFaceArtifactSource;
      readonly state: "incomplete-manifest";
    }
  | {
      readonly artifact: {
        readonly fileCount: number;
        readonly manifestSha256: string;
        readonly modelRevision: string;
        readonly totalBytes: number;
      };
      readonly license: LocalEmbeddingArtifactLicense;
      readonly model: LocalEmbeddingArtifactCatalogModelSummary;
      readonly source: HuggingFaceArtifactSource;
      readonly state: "available";
    };

export interface IncompleteLocalEmbeddingArtifactCatalogEntry {
  readonly license: LocalEmbeddingArtifactLicense;
  readonly model: LocalEmbeddingModelSpec;
  readonly source: HuggingFaceArtifactSource;
  readonly state: "incomplete-manifest";
}

export interface CompleteLocalEmbeddingArtifactCatalogEntry {
  readonly license: LocalEmbeddingArtifactLicense;
  readonly manifest: LocalEmbeddingArtifactManifest;
  readonly manifestSha256: string;
  readonly model: LocalEmbeddingModelSpec;
  readonly source: HuggingFaceArtifactSource;
  readonly state: "available";
}

export type LocalEmbeddingArtifactCatalogEntry =
  | CompleteLocalEmbeddingArtifactCatalogEntry
  | IncompleteLocalEmbeddingArtifactCatalogEntry;

/**
 * Main-process catalog boundary. A complete entry is validated once at startup
 * and can produce the only source/plan pair accepted by the downloader. An
 * incomplete entry is deliberately visible but cannot create a download plan.
 */
export class LocalEmbeddingArtifactCatalog {
  private readonly entry: LocalEmbeddingArtifactCatalogEntry;

  constructor(entry: LocalEmbeddingArtifactCatalogEntry) {
    validateCatalogEntry(entry);
    this.entry = cloneCatalogEntry(entry);
  }

  getStatus(): LocalEmbeddingArtifactCatalogStatus {
    const { license, model, source } = this.entry;
    const summary = modelSummary(model);
    if (this.entry.state === "incomplete-manifest") {
      return {
        license: cloneLicense(license),
        model: summary,
        reason: "full-file-sha256-required",
        source: cloneSource(source),
        state: "incomplete-manifest",
      };
    }
    return {
      artifact: {
        fileCount: this.entry.manifest.files.length,
        manifestSha256: this.entry.manifestSha256,
        modelRevision: this.entry.manifest.modelRevision,
        totalBytes: manifestTotalBytes(this.entry.manifest),
      },
      license: cloneLicense(license),
      model: summary,
      source: cloneSource(source),
      state: "available",
    };
  }

  /**
   * Main-process-only pair for the private installer/downloader boundary. A
   * renderer never receives this plan, its full file list, or a local path.
   */
  createDownloadRequest(consent: LocalEmbeddingArtifactInstallConsent): {
    readonly plan: LocalEmbeddingArtifactInstallPlan;
    readonly source: HuggingFaceArtifactSource;
  } {
    if (this.entry.state !== "available") {
      throw new Error("Local embedding artifact catalog is missing a complete SHA-256 manifest");
    }
    if (!consent || consent.acceptedLicenseId !== this.entry.license.id) {
      throw new Error("Local embedding artifact consent does not match the catalog license");
    }
    return {
      plan: {
        consent: { ...consent },
        license: cloneLicense(this.entry.license),
        manifest: cloneManifest(this.entry.manifest),
        manifestSha256: this.entry.manifestSha256,
        model: cloneModel(this.entry.model),
      },
      source: cloneSource(this.entry.source),
    };
  }
}

const selectedModel = LOCAL_EMBEDDING_MODEL_PRESETS.multilingualE5Small;
const selectedSource = {
  repositoryId: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
} as const;

/**
 * Exact offline layout documented by Transformers.js. The two regular JSON
 * files were independently SHA-256 checked at the pinned commit; the ONNX and
 * tokenizer entries use the repository's LFS SHA-256 object IDs and sizes.
 */
const multilingualE5SmallManifest: LocalEmbeddingArtifactManifest = {
  artifactModelId: selectedModel.artifactModelId,
  files: [
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
  ],
  modelId: selectedModel.id,
  modelRevision: selectedSource.revision,
  runtimeId: "transformers-js",
  runtimeVersion: "3.8.1",
  schemaVersion: 1,
  sourceModelId: selectedModel.sourceModelId,
};
const multilingualE5SmallManifestSha256 =
  "354ad9e76a40160b4fc5f86f15a9bba2114378c1f3b3c7ed3addc8e2c44db929";

/**
 * The first production candidate uses a full, immutable file manifest. The
 * catalog validates this hard-coded digest before it can make a downloader
 * request, so a future source edit cannot silently alter the artifact bytes.
 */
export const LOCAL_EMBEDDING_ARTIFACT_CATALOG = new LocalEmbeddingArtifactCatalog({
  license: { id: "mit", label: "MIT License" },
  manifest: multilingualE5SmallManifest,
  manifestSha256: multilingualE5SmallManifestSha256,
  model: selectedModel,
  source: selectedSource,
  state: "available",
});

export function getLocalEmbeddingArtifactCatalogStatus(): LocalEmbeddingArtifactCatalogStatus {
  return LOCAL_EMBEDDING_ARTIFACT_CATALOG.getStatus();
}

function cloneCatalogEntry(
  entry: LocalEmbeddingArtifactCatalogEntry,
): LocalEmbeddingArtifactCatalogEntry {
  if (entry.state === "incomplete-manifest") {
    return {
      license: cloneLicense(entry.license),
      model: cloneModel(entry.model),
      source: cloneSource(entry.source),
      state: "incomplete-manifest",
    };
  }
  return {
    license: cloneLicense(entry.license),
    manifest: cloneManifest(entry.manifest),
    manifestSha256: entry.manifestSha256,
    model: cloneModel(entry.model),
    source: cloneSource(entry.source),
    state: "available",
  };
}

function cloneLicense(license: LocalEmbeddingArtifactLicense): LocalEmbeddingArtifactLicense {
  return { ...license };
}

function cloneManifest(manifest: LocalEmbeddingArtifactManifest): LocalEmbeddingArtifactManifest {
  return { ...manifest, files: manifest.files.map((file) => ({ ...file })) };
}

function cloneModel(model: LocalEmbeddingModelSpec): LocalEmbeddingModelSpec {
  return { ...model };
}

function cloneSource(source: HuggingFaceArtifactSource): HuggingFaceArtifactSource {
  return { ...source };
}

function manifestTotalBytes(manifest: LocalEmbeddingArtifactManifest): number {
  const totalBytes = manifest.files.reduce((total, file) => total + file.byteLength, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new Error("Local embedding artifact catalog manifest has an invalid total size");
  }
  return totalBytes;
}

function modelSummary(model: LocalEmbeddingModelSpec): LocalEmbeddingArtifactCatalogModelSummary {
  return {
    artifactModelId: model.artifactModelId,
    id: model.id,
    sourceModelId: model.sourceModelId,
  };
}

function validateCatalogEntry(entry: LocalEmbeddingArtifactCatalogEntry): void {
  if (!entry || typeof entry !== "object") {
    throw new Error("Local embedding artifact catalog entry is invalid");
  }
  validateLicense(entry.license);
  validateModelAndSource(entry.model, entry.source);
  if (entry.state === "incomplete-manifest") return;
  if (entry.state !== "available") {
    throw new Error("Local embedding artifact catalog entry state is invalid");
  }
  const manifest = entry.manifest;
  const expectedManifestSha256 = canonicalLocalEmbeddingArtifactManifestSha256(manifest);
  if (entry.manifestSha256 !== expectedManifestSha256) {
    throw new Error("Local embedding artifact catalog manifest does not match its pinned digest");
  }
  if (
    manifest.modelId !== entry.model.id ||
    manifest.sourceModelId !== entry.model.sourceModelId ||
    manifest.artifactModelId !== entry.model.artifactModelId
  ) {
    throw new Error("Local embedding artifact catalog manifest does not match its model");
  }
  if (
    manifest.artifactModelId !== entry.source.repositoryId ||
    manifest.modelRevision !== entry.source.revision
  ) {
    throw new Error("Local embedding artifact catalog manifest does not match its source");
  }
  manifestTotalBytes(manifest);
}

function validateLicense(license: LocalEmbeddingArtifactLicense): void {
  if (
    !license ||
    typeof license !== "object" ||
    typeof license.id !== "string" ||
    !license.id.trim() ||
    typeof license.label !== "string" ||
    !license.label.trim()
  ) {
    throw new Error("Local embedding artifact catalog license is invalid");
  }
}

function validateModelAndSource(
  model: LocalEmbeddingModelSpec,
  source: HuggingFaceArtifactSource,
): void {
  if (
    !model ||
    typeof model !== "object" ||
    typeof model.id !== "string" ||
    !model.id.trim() ||
    typeof model.artifactModelId !== "string" ||
    !model.artifactModelId.trim() ||
    typeof model.sourceModelId !== "string" ||
    !model.sourceModelId.trim()
  ) {
    throw new Error("Local embedding artifact catalog model is invalid");
  }
  if (
    !source ||
    typeof source !== "object" ||
    !HUGGING_FACE_REPOSITORY_ID.test(source.repositoryId) ||
    !GIT_COMMIT_SHA.test(source.revision)
  ) {
    throw new Error("Local embedding artifact catalog source is invalid");
  }
  if (model.artifactModelId !== source.repositoryId) {
    throw new Error("Local embedding artifact catalog model does not match its source repository");
  }
}
