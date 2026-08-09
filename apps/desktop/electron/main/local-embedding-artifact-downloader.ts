import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  LocalEmbeddingArtifactInstallPlan,
  LocalEmbeddingArtifactInstallResult,
  LocalEmbeddingArtifactInstallSession,
  LocalEmbeddingArtifactInstaller,
} from "./local-embedding-artifact-installer";

const HUGGING_FACE_REPOSITORY_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const GIT_COMMIT_SHA = /^[a-f0-9]{40}$/;
const MAX_ARTIFACT_PATH_LENGTH = 1_024;
/** Bounds each HTTP response so a proxy drop cannot invalidate a large model download. */
export const MAX_LOCAL_EMBEDDING_ARTIFACT_RESPONSE_BYTES = 1024 * 1024;
const MAX_NETWORK_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 250;

export interface HuggingFaceArtifactSource {
  readonly repositoryId: string;
  /** Immutable 40-character Git commit, never a moving branch name. */
  readonly revision: string;
}

export interface LocalEmbeddingArtifactDownloadProgress {
  readonly completedBytes: number;
  readonly fileCount: number;
  readonly fileIndex: number;
  /** Safe artifact-relative path, not a local staging path. */
  readonly filePath: string;
  readonly totalBytes: number;
}

export interface LocalEmbeddingArtifactDownloadOptions {
  readonly installer: Pick<
    LocalEmbeddingArtifactInstaller,
    "abortInstall" | "beginInstall" | "completeInstall"
  >;
  readonly onProgress?: (progress: LocalEmbeddingArtifactDownloadProgress) => void;
  readonly plan: LocalEmbeddingArtifactInstallPlan;
  readonly signal?: AbortSignal;
  readonly source: HuggingFaceArtifactSource;
}

export interface LocalEmbeddingArtifactFetchResponse {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly ok: boolean;
  readonly status: number;
}

export type LocalEmbeddingArtifactFetch = (
  url: string,
  options: { headers: Readonly<Record<string, string>>; signal?: AbortSignal },
) => Promise<LocalEmbeddingArtifactFetchResponse>;

export interface LocalEmbeddingArtifactDownloaderDependencies {
  readonly fetch: LocalEmbeddingArtifactFetch;
}

const defaultDependencies: LocalEmbeddingArtifactDownloaderDependencies = {
  fetch: (url, options) => fetch(url, options),
};

/**
 * Builds the only supported download URL shape. A caller must provide an
 * immutable model-repository commit; renderer input never reaches this helper.
 */
export function huggingFaceArtifactDownloadUrl(
  source: HuggingFaceArtifactSource,
  artifactPath: string,
): string {
  const repositoryId = requireRepositoryId(source.repositoryId);
  const revision = requireRevision(source.revision);
  const path = requireArtifactRelativePath(artifactPath);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://huggingface.co/${repositoryId}/resolve/${revision}/${encodedPath}`;
}

/**
 * Streams an already-consented, catalog-pinned artifact into the installer's
 * private stage. Every response is checked during streaming and the installer
 * repeats the check before its atomic publish. Any network or integrity error
 * aborts the stage, leaving no partially usable local model.
 */
export async function downloadAndInstallLocalEmbeddingArtifact(
  options: LocalEmbeddingArtifactDownloadOptions,
  dependencies: LocalEmbeddingArtifactDownloaderDependencies = defaultDependencies,
): Promise<LocalEmbeddingArtifactInstallResult> {
  throwIfAborted(options.signal);
  const source = normalizeSource(options.source);
  const files = requirePlanFilesForSource(options.plan, source);
  const downloads = files.map((file) => ({
    file,
    url: huggingFaceArtifactDownloadUrl(source, file.path),
  }));
  const totalBytes = files.reduce((total, file) => total + file.byteLength, 0);
  const session = await options.installer.beginInstall(options.plan);
  let completedBytes = 0;

  try {
    for (let index = 0; index < downloads.length; index += 1) {
      throwIfAborted(options.signal);
      const download = downloads[index]!;
      const target = stagingArtifactPath(session, download.file.path);
      await fs.mkdir(dirname(target), { mode: 0o700, recursive: true });
      const downloadedBytes = await downloadFileToStage({
        expectedByteLength: download.file.byteLength,
        expectedSha256: download.file.sha256,
        fetch: dependencies.fetch,
        onChunk: (chunkBytes) => {
          completedBytes += chunkBytes;
          reportProgress(options.onProgress, {
            completedBytes,
            fileCount: downloads.length,
            fileIndex: index,
            filePath: download.file.path,
            totalBytes,
          });
        },
        signal: options.signal,
        target,
        url: download.url,
      });
      if (downloadedBytes !== download.file.byteLength) {
        throw new Error("Local embedding artifact response has an unexpected byte length");
      }
    }
    return await options.installer.completeInstall(session);
  } catch (error) {
    await options.installer.abortInstall(session).catch(() => {});
    throw error;
  }
}

async function downloadFileToStage({
  expectedByteLength,
  expectedSha256,
  fetch,
  onChunk,
  signal,
  target,
  url,
}: {
  expectedByteLength: number;
  expectedSha256: string;
  fetch: LocalEmbeddingArtifactFetch;
  onChunk: (byteLength: number) => void;
  signal: AbortSignal | undefined;
  target: string;
  url: string;
}): Promise<number> {
  const hash = createHash("sha256");
  let byteLength = 0;
  let handle: fs.FileHandle | null = null;
  try {
    const openedHandle = await fs.open(target, "wx", 0o600);
    handle = openedHandle;
    while (byteLength < expectedByteLength) {
      throwIfAborted(signal);
      const expectedSegmentByteLength = Math.min(
        MAX_LOCAL_EMBEDDING_ARTIFACT_RESPONSE_BYTES,
        expectedByteLength - byteLength,
      );
      const end = byteLength + expectedSegmentByteLength - 1;
      const response = await fetchArtifactResponse({
        fetch,
        range: `bytes=${byteLength}-${end}`,
        signal,
        url,
      });
      const segmentByteLength = await streamResponseSegmentToFile({
        body: response.body,
        expectedByteLength: expectedSegmentByteLength,
        handle: openedHandle,
        hash,
        onChunk,
        signal,
      });
      byteLength += segmentByteLength;
    }
    if (hash.digest("hex") !== expectedSha256) {
      throw new Error("Local embedding artifact response does not match its manifest digest");
    }
    return byteLength;
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = null;
    await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  } finally {
    await handle?.close();
  }
}

async function fetchArtifactResponse({
  fetch,
  range,
  signal,
  url,
}: {
  fetch: LocalEmbeddingArtifactFetch;
  range: string;
  signal: AbortSignal | undefined;
  url: string;
}): Promise<LocalEmbeddingArtifactFetchResponse & { body: ReadableStream<Uint8Array> }> {
  let latestError: unknown = null;
  for (let attempt = 1; attempt <= MAX_NETWORK_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    let response: LocalEmbeddingArtifactFetchResponse;
    try {
      response = await fetch(url, { headers: { Range: range }, signal });
    } catch (error) {
      throwIfAborted(signal);
      latestError = error;
      if (attempt < MAX_NETWORK_ATTEMPTS) await retryDelay(attempt, signal);
      continue;
    }
    if (response.ok && response.body) {
      return response as LocalEmbeddingArtifactFetchResponse & { body: ReadableStream<Uint8Array> };
    }
    const error = new Error(`Local embedding artifact download failed (HTTP ${response.status})`);
    if (!isTransientHttpResponse(response.status)) throw error;
    latestError = error;
    if (attempt < MAX_NETWORK_ATTEMPTS) await retryDelay(attempt, signal);
  }
  throw latestError instanceof Error
    ? latestError
    : new Error("Local embedding artifact download failed after retrying");
}

function isTransientHttpResponse(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function retryDelay(attempt: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS * attempt));
  throwIfAborted(signal);
}

async function streamResponseSegmentToFile({
  body,
  expectedByteLength,
  handle,
  hash,
  onChunk,
  signal,
}: {
  body: ReadableStream<Uint8Array>;
  expectedByteLength: number;
  handle: fs.FileHandle;
  hash: ReturnType<typeof createHash>;
  onChunk: (byteLength: number) => void;
  signal: AbortSignal | undefined;
}): Promise<number> {
  const reader = body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) continue;
      byteLength += value.byteLength;
      if (byteLength > expectedByteLength) {
        throw new Error("Local embedding artifact response exceeds its manifest size");
      }
      hash.update(value);
      await writeAll(handle, value);
      onChunk(value.byteLength);
    }
    if (byteLength !== expectedByteLength) {
      throw new Error("Local embedding artifact response has an unexpected byte length");
    }
    return byteLength;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function writeAll(handle: fs.FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten <= 0) throw new Error("Could not write local embedding artifact file");
    offset += result.bytesWritten;
  }
}

function stagingArtifactPath(
  session: LocalEmbeddingArtifactInstallSession,
  artifactPath: string,
): string {
  if (!isAbsolute(session.artifactDirectory)) {
    throw new Error("Local embedding installer provided an invalid staging path");
  }
  const safePath = requireArtifactRelativePath(artifactPath);
  const target = join(session.artifactDirectory, ...safePath.split("/"));
  const relation = relative(resolve(session.artifactDirectory), resolve(target));
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error("Local embedding artifact path escapes its private staging directory");
  }
  return target;
}

function normalizeSource(source: HuggingFaceArtifactSource): HuggingFaceArtifactSource {
  return {
    repositoryId: requireRepositoryId(source.repositoryId),
    revision: requireRevision(source.revision),
  };
}

/**
 * The manifest is the catalog's identity record, not merely a checksum list.
 * Bind it to the exact Hugging Face repository and commit before a private
 * stage exists, so a future caller cannot pair verified bytes with a different
 * model source or moving source record.
 */
function requirePlanFilesForSource(
  plan: LocalEmbeddingArtifactInstallPlan,
  source: HuggingFaceArtifactSource,
): readonly LocalEmbeddingArtifactInstallPlan["manifest"]["files"][number][] {
  const manifest = plan?.manifest;
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) {
    throw new Error("Local embedding artifact download plan is invalid");
  }
  if (manifest.artifactModelId !== source.repositoryId) {
    throw new Error(
      "Local embedding artifact download source does not match its manifest repository",
    );
  }
  if (manifest.modelRevision !== source.revision) {
    throw new Error(
      "Local embedding artifact download source does not match its manifest revision",
    );
  }
  return manifest.files;
}

function requireRepositoryId(value: unknown): string {
  if (typeof value !== "string" || !HUGGING_FACE_REPOSITORY_ID.test(value)) {
    throw new Error("Local embedding artifact repository id is invalid");
  }
  return value;
}

function requireRevision(value: unknown): string {
  if (typeof value !== "string" || !GIT_COMMIT_SHA.test(value)) {
    throw new Error("Local embedding artifact revision must be an immutable Git commit");
  }
  return value;
}

function requireArtifactRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ARTIFACT_PATH_LENGTH) {
    throw new Error("Local embedding artifact file path is invalid");
  }
  if (value.startsWith("/") || value.includes("\\") || value.includes("\u0000")) {
    throw new Error("Local embedding artifact file path is invalid");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Local embedding artifact file path is invalid");
  }
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Local embedding artifact download was aborted");
    error.name = "AbortError";
    throw error;
  }
}

function reportProgress(
  callback: ((progress: LocalEmbeddingArtifactDownloadProgress) => void) | undefined,
  progress: LocalEmbeddingArtifactDownloadProgress,
): void {
  try {
    callback?.(progress);
  } catch {
    // Progress observers must not turn a verified download into a failed one.
  }
}
