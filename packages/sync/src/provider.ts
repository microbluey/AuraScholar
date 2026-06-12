// SyncProvider is the second business-model cornerstone interface: anything
// that can store named blobs can be a sync backend. Implementations:
//   webdav        — NAS, Nutstore (坚果云), Nextcloud, any WebDAV server (BYO)
//   local-folder  — a directory synced by iCloud/Dropbox/OneDrive (BYO)
//   s3            — any S3-compatible object store (BYO)
//   official      — paid managed cloud, same interface
//
// The sync engine builds everything on these four primitives. Remote layout:
//   journal/<deviceId>/<startSeq>-<endSeq>.jsonl   append-only change segments
//   snapshot/<hlc>.json                            periodic compaction
//   blobs/<sha256>                                 content-addressed PDFs (immutable)

export interface RemoteObject {
  /** Provider-relative path, e.g. "journal/dev-a/1-100.jsonl". */
  path: string;
  size: number;
  /** Opaque version tag (ETag) when the backend provides one. */
  etag?: string;
}

export interface SyncProvider {
  readonly id: string;
  /** Lists objects under a path prefix (non-recursive listing is fine; engine uses flat prefixes). */
  list(prefix: string): Promise<RemoteObject[]>;
  get(path: string): Promise<Uint8Array>;
  put(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  /** Cheap connectivity/auth check used by the settings UI. */
  ping(): Promise<void>;
}
