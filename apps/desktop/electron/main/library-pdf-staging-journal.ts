import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { dirname, join } from "node:path";

const JOURNAL_FILE = "library-pdf-staging-journal-v1.json";
const JOURNAL_VERSION = 1;
const MAX_JOURNAL_BYTES = 64 * 1024;
const MAX_JOURNAL_SHA_ENTRIES = 512;
const MAX_STAGED_SHA_COUNT = 128;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface JournalState {
  orphaned: Set<string>;
  staged: Map<string, number>;
}

interface SerializedJournal {
  orphaned: string[];
  staged: Record<string, number>;
  version: number;
}

/** A main-only durable ledger; it never stores stage IDs or renderer capabilities. */
export interface LibraryPdfStagingJournal {
  clearOrphanCandidate(sha: string): Promise<void>;
  clearRecoveredCandidate(sha: string): Promise<void>;
  markCommitted(sha: string): Promise<void>;
  markOrphaned(sha: string): Promise<void>;
  recordStage(sha: string): Promise<void>;
  recoveryCandidates(): Promise<string[]>;
}

/** Thrown for malformed or unsafe journal state; callers must retain blobs. */
export class LibraryPdfStagingJournalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryPdfStagingJournalError";
  }
}

export function libraryPdfStagingJournalPath(userDataRoot: string): string {
  return join(userDataRoot, ".ingest-staging", JOURNAL_FILE);
}

export function createLibraryPdfStagingJournal(userDataRoot: string): LibraryPdfStagingJournal {
  const path = libraryPdfStagingJournalPath(userDataRoot);
  let state: JournalState | null = null;
  let tail: Promise<void> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function load(): Promise<JournalState> {
    if (state) return state;
    state = await readJournal(path);
    return state;
  }

  async function mutate(operation: (next: JournalState) => void): Promise<void> {
    const current = await load();
    const next = cloneState(current);
    operation(next);
    await writeJournal(path, next);
    state = next;
  }

  return {
    clearOrphanCandidate(sha) {
      return serialize(async () => {
        assertSha(sha);
        await mutate((next) => next.orphaned.delete(sha));
      });
    },

    clearRecoveredCandidate(sha) {
      return serialize(async () => {
        assertSha(sha);
        await mutate((next) => {
          next.orphaned.delete(sha);
          next.staged.delete(sha);
        });
      });
    },

    markCommitted(sha) {
      return serialize(async () => {
        assertSha(sha);
        await mutate((next) => decrementStage(next, sha));
      });
    },

    markOrphaned(sha) {
      return serialize(async () => {
        assertSha(sha);
        await mutate((next) => {
          decrementStage(next, sha);
          next.orphaned.add(sha);
        });
      });
    },

    recordStage(sha) {
      return serialize(async () => {
        assertSha(sha);
        await mutate((next) => {
          const count = (next.staged.get(sha) ?? 0) + 1;
          if (count > MAX_STAGED_SHA_COUNT) {
            throw new LibraryPdfStagingJournalError("PDF staging journal SHA count is invalid");
          }
          next.staged.set(sha, count);
          assertJournalEntryLimit(next);
        });
      });
    },

    recoveryCandidates() {
      return serialize(async () => {
        const loaded = await load();
        return [...new Set([...loaded.staged.keys(), ...loaded.orphaned])].sort();
      });
    },
  };
}

function decrementStage(state: JournalState, sha: string): void {
  const count = state.staged.get(sha);
  if (!count) throw new LibraryPdfStagingJournalError("PDF staging journal entry is unavailable");
  if (count === 1) state.staged.delete(sha);
  else state.staged.set(sha, count - 1);
}

function cloneState(state: JournalState): JournalState {
  return { orphaned: new Set(state.orphaned), staged: new Map(state.staged) };
}

async function readJournal(path: string): Promise<JournalState> {
  try {
    if (!(await assertSafeDirectoryIfPresent(dirname(path)))) {
      return { orphaned: new Set(), staged: new Map() };
    }
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOURNAL_BYTES) {
      throw new LibraryPdfStagingJournalError("PDF staging journal is unsafe or malformed");
    }
    const serialized = await fs.readFile(path, "utf8");
    return parseJournal(serialized);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { orphaned: new Set(), staged: new Map() };
    }
    if (error instanceof LibraryPdfStagingJournalError) throw error;
    throw new LibraryPdfStagingJournalError("PDF staging journal could not be read", {
      cause: error,
    });
  }
}

async function assertSafeDirectoryIfPresent(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new LibraryPdfStagingJournalError("PDF staging journal directory is unsafe");
    }
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    if (error instanceof LibraryPdfStagingJournalError) throw error;
    throw new LibraryPdfStagingJournalError("PDF staging journal directory is unavailable", {
      cause: error,
    });
  }
}

function parseJournal(serialized: string): JournalState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new LibraryPdfStagingJournalError("PDF staging journal is malformed", { cause: error });
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 3) {
    throw new LibraryPdfStagingJournalError("PDF staging journal is malformed");
  }
  const { orphaned, staged, version } = parsed;
  if (version !== JOURNAL_VERSION || !Array.isArray(orphaned) || !isRecord(staged)) {
    throw new LibraryPdfStagingJournalError("PDF staging journal is malformed");
  }
  const nextOrphaned = new Set<string>();
  for (const sha of orphaned) {
    if (typeof sha !== "string" || !SHA256_PATTERN.test(sha) || nextOrphaned.has(sha)) {
      throw new LibraryPdfStagingJournalError("PDF staging journal is malformed");
    }
    nextOrphaned.add(sha);
  }
  const nextStaged = new Map<string, number>();
  for (const [sha, count] of Object.entries(staged)) {
    if (
      !SHA256_PATTERN.test(sha) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      count > MAX_STAGED_SHA_COUNT
    ) {
      throw new LibraryPdfStagingJournalError("PDF staging journal is malformed");
    }
    nextStaged.set(sha, count);
  }
  const state = { orphaned: nextOrphaned, staged: nextStaged };
  assertJournalEntryLimit(state);
  return state;
}

function assertJournalEntryLimit(state: JournalState): void {
  if (new Set([...state.orphaned, ...state.staged.keys()]).size > MAX_JOURNAL_SHA_ENTRIES) {
    throw new LibraryPdfStagingJournalError("PDF staging journal has too many entries");
  }
}

async function writeJournal(path: string, state: JournalState): Promise<void> {
  const root = dirname(path);
  await ensureSafeDirectory(root);
  if (state.orphaned.size === 0 && state.staged.size === 0) {
    await removeJournal(path);
    return;
  }
  await assertSafeExistingJournal(path);
  const temporary = join(root, `.${JOURNAL_FILE}-${process.pid}-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(temporary, createExclusiveFlags(), 0o600);
    await handle.writeFile(JSON.stringify(serializeState(state)) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, path);
    await fs.chmod(path, 0o600).catch(() => {});
    // POSIX directory fsync makes the atomic rename durable across a sudden
    // power loss. Some platforms reject directory handles, so content fsync
    // above remains the portable baseline.
    await syncDirectory(root);
  } catch (error) {
    if (error instanceof LibraryPdfStagingJournalError) throw error;
    throw new LibraryPdfStagingJournalError("PDF staging journal could not be written", {
      cause: error,
    });
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function serializeState(state: JournalState): SerializedJournal {
  return {
    orphaned: [...state.orphaned].sort(),
    staged: Object.fromEntries(
      [...state.staged.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    version: JOURNAL_VERSION,
  };
}

async function removeJournal(path: string): Promise<void> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new LibraryPdfStagingJournalError("PDF staging journal is unsafe or malformed");
    }
    await fs.unlink(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    if (error instanceof LibraryPdfStagingJournalError) throw error;
    throw new LibraryPdfStagingJournalError("PDF staging journal could not be removed", {
      cause: error,
    });
  }
}

async function assertSafeExistingJournal(path: string): Promise<void> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new LibraryPdfStagingJournalError("PDF staging journal is unsafe or malformed");
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function ensureSafeDirectory(path: string): Promise<void> {
  try {
    await fs.mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new LibraryPdfStagingJournalError("PDF staging journal directory is unsafe");
    }
  } catch (error) {
    if (error instanceof LibraryPdfStagingJournalError) throw error;
    throw new LibraryPdfStagingJournalError("PDF staging journal directory is unavailable", {
      cause: error,
    });
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(path, "r");
    await handle.sync();
  } catch {
    // Windows and some filesystems do not allow a directory handle to sync.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function assertSha(sha: string): void {
  if (!SHA256_PATTERN.test(sha))
    throw new LibraryPdfStagingJournalError("PDF staging SHA is invalid");
}

function createExclusiveFlags(): number {
  return process.platform === "win32"
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
