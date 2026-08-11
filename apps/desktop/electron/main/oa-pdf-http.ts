import { lookup as lookupDns } from "node:dns/promises";
import { request as requestHttps, type RequestOptions } from "node:https";
import { isIP, type LookupFunction } from "node:net";

/**
 * OA landing services often hand back publisher URLs. Unlike the fixed
 * scholarly-metadata allowlist, those URLs deliberately span many origins, so
 * this transport validates the resolved peer and pins the TCP connection to
 * that audited address before it sends an HTTPS request.
 */
export const OA_PDF_MAX_BYTES = 64 * 1024 * 1024;
export const OA_PDF_MAX_REDIRECTS = 5;
export const OA_PDF_TIMEOUT_MS = 60_000;

export interface AuditedPublicAddress {
  address: string;
  family: 4 | 6;
}

export interface OaPdfHttpResponse {
  body: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
  status: number;
}

export interface OaPdfDownload {
  bytes: Uint8Array;
  /** Final, validated HTTPS URL. This is main-only provenance, never IPC output. */
  sourceUrl: string;
}

export interface OaPdfHttpDependencies {
  /** Test seam; production uses DNS with all answers kept verbatim. */
  resolvePublicAddress?(hostname: string): Promise<AuditedPublicAddress>;
  /**
   * Test seam for the actual HTTPS request. Production always uses
   * `requestPinnedHttps`, which binds DNS lookup to the audited address.
   */
  requestPinnedHttps?(url: URL, address: AuditedPublicAddress): Promise<OaPdfHttpResponse>;
}

/**
 * Fetch one OA PDF candidate without turning a database-derived URL into an
 * internal-network proxy. Every redirect is parsed, HTTPS-validated, DNS
 * resolved, and connected through a fresh address pin before the next hop.
 */
export async function fetchPinnedOaPdf(
  rawUrl: string,
  dependencies: OaPdfHttpDependencies = {},
): Promise<OaPdfDownload | null> {
  const resolvePublicAddress = dependencies.resolvePublicAddress ?? resolveOaPdfPublicAddress;
  const request = dependencies.requestPinnedHttps ?? requestPinnedHttps;
  let currentUrl = validateOaPdfUrl(rawUrl);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const address = await resolvePublicAddress(hostnameFor(currentUrl));
    assertAuditedPublicAddress(address);
    const response = await request(currentUrl, address);

    if (isRedirect(response.status)) {
      const location = response.headers.location;
      if (!location || redirectCount >= OA_PDF_MAX_REDIRECTS) return null;
      try {
        currentUrl = validateOaPdfUrl(new URL(location, currentUrl).toString());
      } catch {
        return null;
      }
      continue;
    }

    if (response.status !== 200 || !isPlausiblePdf(response.body)) return null;
    return { bytes: response.body, sourceUrl: canonicalProvenanceUrl(currentUrl) };
  }
}

/** Reject caller URLs that could bypass TLS hostname verification or scan ports. */
export function validateOaPdfUrl(rawUrl: string): URL {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 16 * 1024) {
    throw new Error("OA PDF 地址无效");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("OA PDF 地址无效");
  }

  if (url.protocol !== "https:") throw new Error("OA PDF 仅允许 HTTPS 地址");
  if (url.username || url.password) throw new Error("OA PDF 地址不能包含用户名或密码");
  // An explicit port expands this capability into a general public-port
  // scanner. HTTPS's standard port is implicit and is all this path needs.
  if (url.port || hasExplicitPort(rawUrl)) throw new Error("OA PDF 地址不能包含端口");

  const hostname = hostnameFor(url);
  if (!hostname || isIP(hostname) !== 0) {
    throw new Error("OA PDF 地址必须使用可解析的域名");
  }
  url.hash = "";
  return url;
}

/**
 * Resolve a hostname once and choose a globally routable answer. The request
 * uses that exact address through `lookup`, so later DNS rebinding cannot
 * change the connection peer.
 */
export async function resolveOaPdfPublicAddress(hostname: string): Promise<AuditedPublicAddress> {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname || isIP(normalizedHostname) !== 0) {
    throw new Error("OA PDF 主机名无效");
  }

  const results = await lookupDns(normalizedHostname, { all: true, verbatim: true });
  for (const result of results) {
    const family = result.family === 4 || result.family === 6 ? result.family : null;
    if (!family || isIP(result.address) !== family || !isPublicIpAddress(result.address)) continue;
    return { address: result.address, family };
  }
  throw new Error("OA PDF 域名未解析到公网地址");
}

/**
 * Build the deliberately unpooled request options used by the live transport.
 * Keeping the hostname for HTTPS and pinning lookup separately preserves TLS
 * SNI/certificate checks while forcing TCP to the audited IP address.
 */
export function pinnedOaPdfRequestOptions(url: URL, address: AuditedPublicAddress): RequestOptions {
  const hostname = hostnameFor(url);
  const lookup: LookupFunction = (requestedHostname, _options, callback) => {
    if (normalizeHostname(requestedHostname) !== hostname) {
      callback(new Error("OA PDF HTTPS lookup hostname changed"), "", 4);
      return;
    }
    callback(null, address.address, address.family);
  };
  return {
    // Disable pooling/agents: no existing connection may be reused for a
    // host that was validated by a different DNS resolution.
    agent: false,
    hostname,
    lookup,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    port: 443,
    protocol: "https:",
    // Retain the original host for certificate verification and TLS SNI; TCP
    // resolution above is nevertheless pinned to `address`.
    servername: hostname,
  };
}

/** Production HTTPS request with no renderer-supplied headers, body, or proxy. */
export function requestPinnedHttps(
  url: URL,
  address: AuditedPublicAddress,
): Promise<OaPdfHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = requestHttps(pinnedOaPdfRequestOptions(url, address), (response) => {
      const status = response.statusCode ?? 0;
      const headers = responseHeaders(response.headers);

      // Redirects and non-successful responses are only control flow. Avoid
      // downloading an arbitrary HTML/error body before the caller rejects it.
      if (isRedirect(status) || status !== 200) {
        response.resume();
        resolve({ body: new Uint8Array(), headers, status });
        return;
      }

      const declaredLength = contentLength(headers["content-length"]);
      if (declaredLength !== null && declaredLength > OA_PDF_MAX_BYTES) {
        response.destroy(new Error("OA PDF response is too large"));
        reject(new Error("OA PDF response is too large"));
        return;
      }

      const chunks: Uint8Array[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer | Uint8Array) => {
        const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        length += bytes.byteLength;
        if (length > OA_PDF_MAX_BYTES) {
          response.destroy(new Error("OA PDF response is too large"));
          return;
        }
        chunks.push(bytes);
      });
      response.once("error", reject);
      response.once("end", () => {
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve({ body, headers, status });
      });
    });

    request.once("error", reject);
    request.setTimeout(OA_PDF_TIMEOUT_MS, () => {
      request.destroy(new Error("OA PDF request timed out"));
    });
    // No body and no caller-controlled headers are ever attached here.
    request.end();
  });
}

/** Exported for deterministic DNS-policy tests and future transport callers. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function assertAuditedPublicAddress(address: AuditedPublicAddress): void {
  if (
    (address.family !== 4 && address.family !== 6) ||
    isIP(address.address) !== address.family ||
    !isPublicIpAddress(address.address)
  ) {
    throw new Error("OA PDF 连接地址未经公网审计");
  }
}

function isPlausiblePdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 1_024 && startsWithPdfMagic(bytes);
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function hostnameFor(url: URL): string {
  return normalizeHostname(url.hostname);
}

function normalizeHostname(value: string): string {
  return value.replace(/^\[|\]$/gu, "").toLowerCase();
}

function canonicalProvenanceUrl(url: URL): string {
  const canonical = new URL(url);
  canonical.hash = "";
  return canonical.toString();
}

function hasExplicitPort(rawUrl: string): boolean {
  // URL normalizes away an explicit default `:443`; do not let that bypass
  // the no-port policy. This parser only runs after `new URL` succeeds.
  const authority = rawUrl.match(/^https:\/\/([^/?#]*)/iu)?.[1] ?? "";
  const host = authority.replace(/^[^@]*@/u, "");
  return host.startsWith("[") ? /^\[[^\]]+\]:/u.test(host) : /:[0-9]*$/u.test(host);
}

function responseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") result[name.toLowerCase()] = value;
    else if (Array.isArray(value)) result[name.toLowerCase()] = value.join(", ");
  }
  return result;
}

function contentLength(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value.trim())) return null;
  const length = Number(value.trim());
  return Number.isSafeInteger(length) ? length : Number.POSITIVE_INFINITY;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC 1918
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // deprecated 6to4 relay anycast
  if (a === 192 && b === 168) return false; // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

function isPublicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero || (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1)) return false;

  // IPv4-compatible/mapped forms must inherit IPv4's public-address policy.
  const isIpv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isIpv4Mapped) {
    return isPublicIpv4(Array.from(bytes.slice(12)).join("."));
  }
  if (bytes.slice(0, 12).every((byte) => byte === 0)) {
    return isPublicIpv4(Array.from(bytes.slice(12)).join("."));
  }

  // Global unicast is 2000::/3. This deliberately rejects ULA, link-local,
  // multicast, loopback, and other non-public address families up front.
  if ((bytes[0]! & 0xe0) !== 0x20) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
    return false; // documentation
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3]! >= 0x10 &&
    bytes[3]! <= 0x1f
  )
    return false; // ORCHID
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x02)
    return false; // benchmarking
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3]! >= 0x20 &&
    bytes[3]! <= 0x2f
  )
    return false; // ORCHIDv2
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false; // 6to4 can encode private IPv4
  return true;
}

function ipv6Bytes(address: string): Uint8Array | null {
  const normalized = address.toLowerCase();
  const pieces = normalized.split("::");
  if (pieces.length > 2) return null;
  const left = expandIpv6Side(pieces[0] ? pieces[0].split(":") : []);
  const right = expandIpv6Side(pieces[1] ? pieces[1].split(":") : []);
  if (!left || !right) return null;
  const hasDoubleColon = pieces.length === 2;
  const zeroCount = 8 - left.length - right.length;
  if ((!hasDoubleColon && zeroCount !== 0) || (hasDoubleColon && zeroCount < 1)) return null;
  const expanded = hasDoubleColon
    ? [...left, ...Array.from({ length: zeroCount }, () => "0"), ...right]
    : left;
  if (expanded.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < expanded.length; index += 1) {
    const group = expanded[index]!;
    if (!/^[0-9a-f]{1,4}$/u.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

function expandIpv6Side(parts: string[]): string[] | null {
  const expanded = [...parts];
  const ipv4 = expanded.at(-1);
  if (!ipv4?.includes(".")) return expanded;
  const octets = ipv4.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }
  expanded.splice(
    expanded.length - 1,
    1,
    ((octets[0]! << 8) | octets[1]!).toString(16),
    ((octets[2]! << 8) | octets[3]!).toString(16),
  );
  return expanded;
}
