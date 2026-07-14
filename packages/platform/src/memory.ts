// In-memory fakes for tests and Storybook.
import type {
  FileSystem,
  HttpClient,
  HttpRequest,
  HttpResponse,
  NotificationOptions,
  Notifier,
  Platform,
  SecretStore,
  BackgroundScheduler,
} from "./index.js";

export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT: ${path}`);
    return data;
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }
  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async listDir(path: string): Promise<string[]> {
    const prefix = path.endsWith("/") ? path : path + "/";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
    }
    return [...names];
  }
  async mkdirp(): Promise<void> {}
}

export class MemorySecretStore implements SecretStore {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export class MemoryNotifier implements Notifier {
  readonly sent: NotificationOptions[] = [];
  async notify(options: NotificationOptions): Promise<void> {
    this.sent.push(options);
  }
}

/** Routes requests to registered handlers; throws on unmatched URLs. */
export class StubHttpClient implements HttpClient {
  private handlers: Array<{
    match: (req: HttpRequest) => boolean;
    respond: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;
  }> = [];
  readonly requests: HttpRequest[] = [];

  on(
    match: string | RegExp | ((req: HttpRequest) => boolean),
    respond: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>,
  ): this {
    const matcher =
      typeof match === "function"
        ? match
        : typeof match === "string"
          ? (req: HttpRequest) => req.url.startsWith(match)
          : (req: HttpRequest) => match.test(req.url);
    this.handlers.push({ match: matcher, respond });
    return this;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    for (const h of this.handlers) {
      if (h.match(req)) return h.respond(req);
    }
    throw new Error(`StubHttpClient: no handler for ${req.method ?? "GET"} ${req.url}`);
  }
}

export function jsonResponse(status: number, data: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(JSON.stringify(data)),
  };
}

export class ImmediateScheduler implements BackgroundScheduler {
  schedule(_taskId: string, _intervalS: number, _callback: () => Promise<void>): () => void {
    return () => {};
  }
}

export function createMemoryPlatform(): Platform & {
  http: StubHttpClient;
  fs: MemoryFileSystem;
  notifier: MemoryNotifier;
  secrets: MemorySecretStore;
} {
  return {
    http: new StubHttpClient(),
    fs: new MemoryFileSystem(),
    notifier: new MemoryNotifier(),
    secrets: new MemorySecretStore(),
    scheduler: new ImmediateScheduler(),
    deviceId: async () => "test-device",
  };
}
