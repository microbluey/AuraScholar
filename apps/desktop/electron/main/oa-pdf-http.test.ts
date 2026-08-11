import { describe, expect, it, vi } from "vitest";
import {
  fetchPinnedOaPdf,
  isPublicIpAddress,
  OA_PDF_MAX_REDIRECTS,
  pinnedOaPdfRequestOptions,
  validateOaPdfUrl,
  type AuditedPublicAddress,
} from "./oa-pdf-http";

const PUBLIC_IP: AuditedPublicAddress = { address: "1.1.1.1", family: 4 };

describe("pinned OA PDF HTTP", () => {
  it("rejects non-HTTPS, credentialed, port-selected, and literal-IP candidates", () => {
    for (const rawUrl of [
      "http://publisher.example/paper.pdf",
      "https://token@publisher.example/paper.pdf",
      "https://publisher.example:443/paper.pdf",
      "https://publisher.example:8443/paper.pdf",
      "https://127.0.0.1/paper.pdf",
      "https://[::1]/paper.pdf",
      "file:///tmp/paper.pdf",
    ]) {
      expect(() => validateOaPdfUrl(rawUrl)).toThrow();
    }
  });

  it("accepts only globally routable DNS answers", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isPublicIpAddress(address)).toBe(false);
    }
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("re-resolves and re-pins every redirect hop before accepting PDF bytes", async () => {
    const resolvedHosts: string[] = [];
    const requested: Array<{ address: string; url: string }> = [];
    const downloaded = await fetchPinnedOaPdf("https://first.publisher.example/paper", {
      async resolvePublicAddress(hostname) {
        resolvedHosts.push(hostname);
        return hostname === "first.publisher.example"
          ? { address: "8.8.8.8", family: 4 }
          : { address: "1.1.1.1", family: 4 };
      },
      async requestPinnedHttps(url, address) {
        requested.push({ address: address.address, url: url.toString() });
        if (url.hostname === "first.publisher.example") {
          return {
            body: new Uint8Array(),
            headers: { location: "https://second.publisher.example/download?token=opaque" },
            status: 302,
          };
        }
        return { body: pdfBytes(), headers: {}, status: 200 };
      },
    });

    expect(downloaded).toEqual({
      bytes: pdfBytes(),
      sourceUrl: "https://second.publisher.example/download?token=opaque",
    });
    expect(resolvedHosts).toEqual(["first.publisher.example", "second.publisher.example"]);
    expect(requested).toEqual([
      { address: "8.8.8.8", url: "https://first.publisher.example/paper" },
      {
        address: "1.1.1.1",
        url: "https://second.publisher.example/download?token=opaque",
      },
    ]);
  });

  it("does not follow an invalid redirect and rejects malformed/small payloads", async () => {
    const request = async () => ({
      body: new Uint8Array(),
      headers: { location: "http://169.254.169.254/latest/meta-data" },
      status: 302,
    });
    await expect(
      fetchPinnedOaPdf("https://publisher.example/paper.pdf", {
        requestPinnedHttps: request,
        resolvePublicAddress: async () => PUBLIC_IP,
      }),
    ).resolves.toBeNull();

    await expect(
      fetchPinnedOaPdf("https://publisher.example/paper.pdf", {
        requestPinnedHttps: async () => ({
          body: new Uint8Array([0x25, 0x50]),
          headers: {},
          status: 200,
        }),
        resolvePublicAddress: async () => PUBLIC_IP,
      }),
    ).resolves.toBeNull();
  });

  it("refuses even an injected resolver result unless it is a public IP of the declared family", async () => {
    const request = vi.fn();
    await expect(
      fetchPinnedOaPdf("https://publisher.example/paper.pdf", {
        requestPinnedHttps: request,
        resolvePublicAddress: async () => ({ address: "127.0.0.1", family: 4 }),
      }),
    ).rejects.toThrow("未经公网审计");
    expect(request).not.toHaveBeenCalled();
  });

  it("stops after the bounded redirect budget", async () => {
    let calls = 0;
    await expect(
      fetchPinnedOaPdf("https://publisher.example/paper.pdf", {
        requestPinnedHttps: async () => {
          calls += 1;
          return { body: new Uint8Array(), headers: { location: "/again" }, status: 302 };
        },
        resolvePublicAddress: async () => PUBLIC_IP,
      }),
    ).resolves.toBeNull();
    expect(calls).toBe(OA_PDF_MAX_REDIRECTS + 1);
  });

  it("pins HTTPS lookup to the audited IP while retaining original-host SNI", async () => {
    const options = pinnedOaPdfRequestOptions(
      new URL("https://publisher.example/download?ticket=opaque"),
      PUBLIC_IP,
    );
    expect(options).toMatchObject({
      agent: false,
      hostname: "publisher.example",
      method: "GET",
      path: "/download?ticket=opaque",
      port: 443,
      protocol: "https:",
      servername: "publisher.example",
    });
    expect(options).not.toHaveProperty("headers");

    const resolved = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      const lookup = options.lookup;
      if (!lookup) throw new Error("Pinned lookup is unavailable");
      lookup("publisher.example", { all: false }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address: address as string, family: family as number });
      });
    });
    expect(resolved).toEqual(PUBLIC_IP);
  });
});

function pdfBytes(): Uint8Array {
  const bytes = new Uint8Array(1_024);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  return bytes;
}
