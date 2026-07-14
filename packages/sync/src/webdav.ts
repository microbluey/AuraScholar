// WebDAV SyncProvider — covers NAS (Synology/QNAP), Nutstore, Nextcloud, etc.
// Uses the platform HttpClient so desktop avoids CORS entirely.
import type { HttpClient } from "@aurascholar/platform";
import type { RemoteObject, SyncProvider } from "./provider.js";

export interface WebDavOptions {
  http: HttpClient;
  /** e.g. "https://dav.example.com/dav/AuraScholar" */
  baseUrl: string;
  username: string;
  password: string;
}

interface WebDavPropfindEntry extends RemoteObject {
  etag: string;
  isCollection: boolean;
}

export class WebDavProvider implements SyncProvider {
  readonly id = "webdav";
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly auth: string;

  constructor(opts: WebDavOptions) {
    this.http = opts.http;
    this.baseUrl = normalizeWebDavBaseUrl(opts.baseUrl);
    this.auth = basicAuthHeader(opts.username, opts.password);
  }

  private url(path: string): string {
    const encodedPath = encodeRemotePath(path);
    return encodedPath ? `${this.baseUrl}/${encodedPath}` : `${this.baseUrl}/`;
  }

  async list(prefix: string): Promise<RemoteObject[]> {
    const objects: RemoteObject[] = [];
    const queue = [asCollectionPrefix(prefix)];
    const seen = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]!;
      if (seen.has(current)) continue;
      seen.add(current);
      const entries = await this.propfind(current);
      for (const entry of entries) {
        if (entry.isCollection) {
          const childPrefix = asCollectionPrefix(entry.path);
          if (!seen.has(childPrefix)) queue.push(childPrefix);
        } else {
          objects.push(toRemoteObject(entry));
        }
      }
    }
    return objects;
  }

  private async propfind(prefix: string): Promise<WebDavPropfindEntry[]> {
    const res = await this.http.request({
      url: this.url(prefix),
      method: "PROPFIND",
      headers: { authorization: this.auth, depth: "1" },
    });
    if (res.status === 404) return [];
    if (res.status >= 300) throw new Error(`WebDAV PROPFIND failed: ${res.status}`);
    return parseWebDavPropfindEntries(new TextDecoder().decode(res.body), this.baseUrl, prefix);
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
    encodeRemotePath(path);
    await this.ensureParents(path);
    const tempPath = tempUploadPath(path);
    let shouldCleanupTemp = false;
    try {
      const putRes = await this.http.request({
        url: this.url(tempPath),
        method: "PUT",
        headers: { authorization: this.auth },
        body: data,
      });
      shouldCleanupTemp = true;
      if (putRes.status >= 300) throw new Error(`WebDAV PUT ${path} failed: ${putRes.status}`);

      const moveRes = await this.http.request({
        url: this.url(tempPath),
        method: "MOVE",
        headers: {
          authorization: this.auth,
          destination: this.url(path),
          overwrite: "T",
        },
      });
      shouldCleanupTemp = false;
      if (![200, 201, 204].includes(moveRes.status)) {
        shouldCleanupTemp = true;
        throw new Error(`WebDAV MOVE ${path} failed: ${moveRes.status}`);
      }
    } catch (error) {
      if (shouldCleanupTemp) {
        try {
          await this.delete(tempPath);
        } catch {
          // Preserve the original upload/publish failure for the UI.
        }
      }
      throw error;
    }
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
      const res = await this.http.request({
        url: this.url(current),
        method: "MKCOL",
        headers: { authorization: this.auth },
      });
      if (![200, 201, 405].includes(res.status)) {
        throw new Error(`WebDAV MKCOL ${current} failed: ${res.status}`);
      }
    }
  }
}

function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/** Minimal PROPFIND multistatus parser (regex-based; avoids an XML dependency). */
export function parseWebDavPropfind(
  xml: string,
  baseUrl: string,
  prefix: string,
): RemoteObject[] {
  return parseWebDavPropfindEntries(xml, normalizeWebDavBaseUrl(baseUrl), prefix).flatMap((entry) => {
    if (entry.isCollection) return [];
    return [toRemoteObject(entry)];
  });
}

function toRemoteObject(entry: WebDavPropfindEntry): RemoteObject {
  return { path: entry.path, size: entry.size, etag: entry.etag };
}

function parseWebDavPropfindEntries(
  xml: string,
  baseUrl: string,
  prefix: string,
): WebDavPropfindEntry[] {
  const objects: WebDavPropfindEntry[] = [];
  const base = new URL(baseUrl);
  const basePath = safeDecodePath(base.pathname).replace(/\/+$/, "");
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const responses = xml.match(/<[^>]*:?response[ >][\s\S]*?<\/[^>]*:?response>/gi) ?? [];
  for (const block of responses) {
    const isCollection = /<[^>]*:?collection\s*\/?>/i.test(block);
    const href = block.match(/<[^>]*:?href[^>]*>([^<]+)<\/[^>]*:?href>/i)?.[1];
    if (!href) continue;
    const rel = remoteHrefToRelativePath(decodeXmlText(href), base, basePath);
    if (!rel || rel === normalizedPrefix) continue;
    if (normalizedPrefix && rel !== normalizedPrefix && !rel.startsWith(`${normalizedPrefix}/`)) {
      continue;
    }
    const size = Number(
      block.match(/<[^>]*:?getcontentlength[^>]*>(\d+)<\/[^>]*:?getcontentlength>/i)?.[1] ?? 0,
    );
    const etag = decodeXmlText(
      block.match(/<[^>]*:?getetag[^>]*>([^<]+)<\/[^>]*:?getetag>/i)?.[1]?.trim() ?? "",
    );
    objects.push({ path: isCollection ? asCollectionPrefix(rel) : rel, size, etag, isCollection });
  }
  return objects;
}

function normalizeWebDavBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("WebDAV 地址不能为空。");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("WebDAV 地址格式不正确，请使用完整的 http:// 或 https:// 地址。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("WebDAV 地址仅支持 http:// 或 https://。");
  }
  if (url.username || url.password) {
    throw new Error("WebDAV 地址不要包含用户名或密码，请使用独立的账号字段。");
  }
  if (url.search || url.hash) {
    throw new Error("WebDAV 地址请填写目录地址，不要包含查询参数或 # 片段。");
  }
  return url.toString().replace(/\/+$/, "");
}

function encodeRemotePath(path: string): string {
  const hasCollectionSlash = path.endsWith("/");
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new Error("WebDAV 对象路径不能包含空段、. 或 ..。");
    }
  }
  return `${parts.map(encodeURIComponent).join("/")}${hasCollectionSlash ? "/" : ""}`;
}

function asCollectionPrefix(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  return normalized ? `${normalized}/` : "";
}

function tempUploadPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const file = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tempFile = `.${file}.aurascholar-upload-${suffix}`;
  return dir ? `${dir}/${tempFile}` : tempFile;
}

function remoteHrefToRelativePath(href: string, base: URL, basePath: string): string {
  const trimmed = href.trim();
  if (!trimmed) return "";
  let path = trimmed;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
      path = new URL(trimmed).pathname;
    } else if (trimmed.startsWith("/")) {
      path = new URL(trimmed, base.origin).pathname;
    }
  } catch {
    path = trimmed;
  }
  const decoded = safeDecodePath(path).replace(/\/+$/, "");
  if (basePath && decoded === basePath) return "";
  if (basePath && decoded.startsWith(`${basePath}/`)) return decoded.slice(basePath.length + 1);
  return decoded.replace(/^\/+/, "");
}

function safeDecodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
