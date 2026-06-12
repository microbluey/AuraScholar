// WebDAV SyncProvider — covers NAS (Synology/QNAP), Nutstore, Nextcloud, etc.
// Uses the platform HttpClient so desktop avoids CORS entirely.
import type { HttpClient } from "@aurascholar/platform";
import type { RemoteObject, SyncProvider } from "./provider";

export interface WebDavOptions {
  http: HttpClient;
  /** e.g. "https://dav.example.com/dav/AuraScholar" */
  baseUrl: string;
  username: string;
  password: string;
}

export class WebDavProvider implements SyncProvider {
  readonly id = "webdav";
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly auth: string;

  constructor(opts: WebDavOptions) {
    this.http = opts.http;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + btoa(`${opts.username}:${opts.password}`);
  }

  private url(path: string): string {
    return `${this.baseUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const res = await this.http.request({
      url: this.url(prefix),
      method: "PROPFIND",
      headers: { authorization: this.auth, depth: "1" },
    });
    if (res.status === 404) return [];
    if (res.status >= 300) throw new Error(`WebDAV PROPFIND failed: ${res.status}`);
    return parsePropfind(new TextDecoder().decode(res.body), this.baseUrl, prefix);
  }

  async get(path: string): Promise<Uint8Array> {
    const res = await this.http.request({
      url: this.url(path),
      method: "GET",
      headers: { authorization: this.auth },
    });
    if (res.status !== 200) throw new Error(`WebDAV GET ${path} failed: ${res.status}`);
    return res.body;
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    await this.ensureParents(path);
    const res = await this.http.request({
      url: this.url(path),
      method: "PUT",
      headers: { authorization: this.auth },
      body: data,
    });
    if (res.status >= 300) throw new Error(`WebDAV PUT ${path} failed: ${res.status}`);
  }

  async delete(path: string): Promise<void> {
    const res = await this.http.request({
      url: this.url(path),
      method: "DELETE",
      headers: { authorization: this.auth },
    });
    if (res.status >= 300 && res.status !== 404)
      throw new Error(`WebDAV DELETE ${path} failed: ${res.status}`);
  }

  async ping(): Promise<void> {
    const res = await this.http.request({
      url: this.baseUrl,
      method: "PROPFIND",
      headers: { authorization: this.auth, depth: "0" },
    });
    if (res.status >= 300) throw new Error(`WebDAV unreachable: ${res.status}`);
  }

  /** MKCOL each missing parent collection (WebDAV has no recursive create). */
  private async ensureParents(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      await this.http.request({
        url: this.url(current),
        method: "MKCOL",
        headers: { authorization: this.auth },
      }); // 405 = already exists, fine
    }
  }
}

/** Minimal PROPFIND multistatus parser (regex-based; avoids an XML dependency). */
function parsePropfind(xml: string, baseUrl: string, prefix: string): RemoteObject[] {
  const objects: RemoteObject[] = [];
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const responses = xml.match(/<[^>]*:?response[ >][\s\S]*?<\/[^>]*:?response>/gi) ?? [];
  for (const block of responses) {
    if (/<[^>]*:?collection\s*\/?>/i.test(block)) continue; // skip directories
    const href = block.match(/<[^>]*:?href[^>]*>([^<]+)<\/[^>]*:?href>/i)?.[1];
    if (!href) continue;
    const decoded = decodeURIComponent(href.trim());
    const rel = decoded.startsWith(basePath) ? decoded.slice(basePath.length + 1) : decoded;
    if (!rel || rel === prefix || rel + "/" === prefix) continue;
    const size = Number(
      block.match(/<[^>]*:?getcontentlength[^>]*>(\d+)<\/[^>]*:?getcontentlength>/i)?.[1] ?? 0,
    );
    const etag = block.match(/<[^>]*:?getetag[^>]*>([^<]+)<\/[^>]*:?getetag>/i)?.[1]?.trim();
    objects.push({ path: rel, size, etag });
  }
  return objects;
}
