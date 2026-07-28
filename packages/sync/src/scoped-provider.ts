import type { RemoteObject, SyncProvider } from "./provider.js";

export interface LibraryScopedSyncProviderOptions {
  /**
   * Merge the pre-namespace journal with scoped objects until bootstrap copies
   * that history and publishes its completion marker. Writes always go to the
   * scoped namespace.
   */
  legacyReadFallback?: boolean;
}

/**
 * Namespaces every remote object for one logical remote Library. Callers must
 * pass a stable transport scope shared by every device connected to the same
 * remote corpus, not a device-local database Library id. The scope segment is
 * UTF-8 hex rather than raw text so slashes, dot segments, and provider-specific
 * path decoding can never escape the Library prefix.
 */
export class LibraryScopedSyncProvider implements SyncProvider {
  private static readonly bootstrapMarker = "journal/.library-scope-v2-complete";
  readonly id: string;
  readonly prefix: string;
  private readonly legacyReadFallback: boolean;
  private readonly readSources = new Map<string, "legacy" | "scoped">();

  constructor(
    private readonly provider: SyncProvider,
    transportScope: string,
    options: LibraryScopedSyncProviderOptions = {},
  ) {
    if (!transportScope.trim()) throw new Error("Remote Library scope is required for sync");
    this.id = provider.id;
    this.prefix = `libraries/${encodeScopeSegment(transportScope)}/`;
    this.legacyReadFallback = options.legacyReadFallback ?? false;
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const normalizedPrefix = normalizeRelativePath(prefix);
    this.readSources.clear();
    const scopedPrefix = this.scopedPath(normalizedPrefix);
    const objects = await this.provider.list(scopedPrefix);
    const scoped = objects.flatMap((object) => {
      if (!object.path.startsWith(this.prefix)) return [];
      const path = object.path.slice(this.prefix.length);
      if (path === LibraryScopedSyncProvider.bootstrapMarker) return [];
      return [{ ...object, path }];
    });
    for (const object of scoped) this.readSources.set(object.path, "scoped");
    const bootstrapComplete = objects.some(
      (object) => object.path === `${this.prefix}${LibraryScopedSyncProvider.bootstrapMarker}`,
    );
    if (
      bootstrapComplete ||
      !this.legacyReadFallback ||
      normalizedPrefix.replace(/\/+$/, "") !== "journal"
    ) {
      return scoped;
    }

    const legacy = await this.provider.list(normalizedPrefix);
    const legacyObjects = legacy.flatMap((object) => {
      const path = normalizeRelativePath(object.path);
      if (!isWithinPrefix(path, normalizedPrefix) || path.startsWith("libraries/")) return [];
      return [{ ...object, path }];
    });
    const combined = new Map(scoped.map((object) => [object.path, object]));
    for (const object of legacyObjects) {
      const scopedObject = combined.get(object.path);
      if (scopedObject) {
        await this.assertSameBytes(object.path);
        continue;
      }
      combined.set(object.path, object);
      this.readSources.set(object.path, "legacy");
    }
    return [...combined.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async get(path: string): Promise<Uint8Array> {
    const normalized = normalizeRelativePath(path);
    if (this.readSources.get(normalized) === "legacy") return await this.provider.get(normalized);
    return await this.provider.get(this.scopedPath(normalized));
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    await this.provider.put(this.scopedPath(path), data);
  }

  async delete(path: string): Promise<void> {
    await this.provider.delete(this.scopedPath(path));
  }

  ping(): Promise<void> {
    return this.provider.ping();
  }

  /**
   * Publish only after a complete pull + push cycle succeeds. Legacy journal
   * objects are copied first so a device joining after the marker still sees a
   * contiguous history from sequence one. Existing identical copies make this
   * operation safe to retry after an interrupted bootstrap.
   */
  async markBootstrapComplete(): Promise<void> {
    const scopedJournalPrefix = this.scopedPath("journal/");
    const currentScopedObjects = await this.provider.list(scopedJournalPrefix);
    if (
      currentScopedObjects.some(
        (object) => object.path === this.scopedPath(LibraryScopedSyncProvider.bootstrapMarker),
      )
    ) {
      return;
    }

    if (this.legacyReadFallback) {
      const legacyObjects = await this.provider.list("journal/");
      const scopedByPath = new Map(
        currentScopedObjects.flatMap((object) => {
          if (!object.path.startsWith(this.prefix)) return [];
          return [[object.path.slice(this.prefix.length), object] as const];
        }),
      );
      for (const object of legacyObjects) {
        const path = normalizeRelativePath(object.path);
        if (
          !isWithinPrefix(path, "journal/") ||
          path.startsWith("libraries/") ||
          path === LibraryScopedSyncProvider.bootstrapMarker
        ) {
          continue;
        }
        const existing = scopedByPath.get(path);
        if (existing) {
          await this.assertSameBytes(path);
          continue;
        }
        const legacyBytes = await this.provider.get(path);
        await this.provider.put(this.scopedPath(path), legacyBytes);
        const copiedBytes = await this.provider.get(this.scopedPath(path));
        if (!bytesEqual(legacyBytes, copiedBytes)) {
          throw new Error(`Conflicting legacy and scoped sync objects at ${path}`);
        }
        scopedByPath.set(path, {
          path: this.scopedPath(path),
          size: copiedBytes.byteLength,
        });
      }
    }

    await this.provider.put(
      this.scopedPath(LibraryScopedSyncProvider.bootstrapMarker),
      new TextEncoder().encode("library-scope-v2\n"),
    );
  }

  private scopedPath(path: string): string {
    const normalized = normalizeRelativePath(path);
    return `${this.prefix}${normalized}`;
  }

  private async assertSameBytes(path: string): Promise<void> {
    const [legacyBytes, scopedBytes] = await Promise.all([
      this.provider.get(path),
      this.provider.get(this.scopedPath(path)),
    ]);
    if (!bytesEqual(legacyBytes, scopedBytes)) {
      throw new Error(`Conflicting legacy and scoped sync objects at ${path}`);
    }
  }
}

function encodeScopeSegment(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeRelativePath(path: string): string {
  const collection = path.endsWith("/");
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) {
    throw new Error("Sync object paths cannot contain empty, dot, or backslash segments");
  }
  return `${segments.join("/")}${collection ? "/" : ""}`;
}

function isWithinPrefix(path: string, prefix: string): boolean {
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  if (!normalizedPrefix) return true;
  return path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}
