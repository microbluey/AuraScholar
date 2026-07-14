// In-memory SyncProvider for tests and as the reference implementation.
import type { RemoteObject, SyncProvider } from "./provider.js";

export class MemorySyncProvider implements SyncProvider {
  readonly id = "memory";
  readonly objects = new Map<string, Uint8Array>();

  async list(prefix: string): Promise<RemoteObject[]> {
    return [...this.objects.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ path, size: data.byteLength }));
  }

  async get(path: string): Promise<Uint8Array> {
    const data = this.objects.get(path);
    if (!data) throw new Error(`Not found: ${path}`);
    return data;
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    this.objects.set(path, data);
  }

  async delete(path: string): Promise<void> {
    this.objects.delete(path);
  }

  async ping(): Promise<void> {}
}
