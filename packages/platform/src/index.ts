// Platform abstraction layer. Domain packages (core, reader, sync, ai,
// connectors) depend ONLY on these interfaces; concrete implementations are
// injected by each app shell:
//   desktop → Tauri commands (native HTTP without CORS, real FS, OS keychain)
//   web     → fetch (CORS-limited), OPFS, WebCrypto-encrypted storage
//   tests   → the in-memory fakes exported from ./memory

export interface HttpRequest {
  url: string;
  /** Plain string to allow WebDAV verbs (PROPFIND, MKCOL, ...). Defaults to GET. */
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
  /** Optional caller-controlled cancellation signal. */
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** HTTP client. The desktop implementation bypasses CORS via the Rust side. */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** Minimal file system surface — paths are app-data-relative. */
export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<string[]>;
  mkdirp(path: string): Promise<void>;
}

export interface NotificationOptions {
  title: string;
  body?: string;
  /** Identifier the app can use to route a click on the notification. */
  tag?: string;
}

export interface Notifier {
  notify(options: NotificationOptions): Promise<void>;
}

/** Secret storage: OS keychain on desktop, WebCrypto-encrypted IDB on web. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Background scheduler for the sentinel poller. Desktop registers a real
 * timer in the Rust host (works while window is closed, tray keeps app
 * alive); web fires only while the page is open — callers must catch up on
 * startup regardless, so missed ticks are safe.
 */
export interface BackgroundScheduler {
  /** Calls back roughly every `intervalS`; returns an unsubscribe function. */
  schedule(taskId: string, intervalS: number, callback: () => Promise<void>): () => void;
}

/** Everything an app shell must provide to the domain layer. */
export interface Platform {
  http: HttpClient;
  fs: FileSystem;
  notifier: Notifier;
  secrets: SecretStore;
  scheduler: BackgroundScheduler;
  /** Stable per-install identifier, used as sync device_id. */
  deviceId(): Promise<string>;
}

export * from "./memory.js";
export * from "./sensitive-text.js";
