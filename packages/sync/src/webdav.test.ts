import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest, HttpResponse } from "@aurascholar/platform";
import { WebDavProvider, parseWebDavPropfind } from "./webdav";

const textEncoder = new TextEncoder();

function response(status: number, body = ""): HttpResponse {
  return { status, headers: {}, body: textEncoder.encode(body) };
}

class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  responses: HttpResponse[] = [];

  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return this.responses.shift() ?? response(200);
  }
}

describe("parseWebDavPropfind", () => {
  it("normalizes absolute and root-relative hrefs to remote object paths", () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>https://dav.example.com/dav/AuraScholar/journal/dev-a/0001-0002.jsonl</d:href>
          <d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:getetag>&quot;abc&quot;</d:getetag></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/AuraScholar/journal/dev-a/name%20with%20space.jsonl</d:href>
          <d:propstat><d:prop><d:getcontentlength>34</d:getcontentlength></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/AuraScholar/journal/dev-a/</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
        </d:response>
        <d:response>
          <d:href>/dav/AuraScholar/other/file.jsonl</d:href>
          <d:propstat><d:prop><d:getcontentlength>56</d:getcontentlength></d:prop></d:propstat>
        </d:response>
      </d:multistatus>`;

    expect(
      parseWebDavPropfind(xml, "https://dav.example.com/dav/AuraScholar", "journal/dev-a/"),
    ).toEqual([
      { path: "journal/dev-a/0001-0002.jsonl", size: 12, etag: '"abc"' },
      { path: "journal/dev-a/name with space.jsonl", size: 34, etag: "" },
    ]);
  });

  it("does not fail the whole listing on malformed percent escapes", () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
      <d:response>
        <d:href>/dav/AuraScholar/journal/dev-a/bad%zz.jsonl</d:href>
        <d:propstat><d:prop><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat>
      </d:response>
    </d:multistatus>`;

    expect(
      parseWebDavPropfind(xml, "https://dav.example.com/dav/AuraScholar", "journal/dev-a/"),
    ).toEqual([{ path: "journal/dev-a/bad%zz.jsonl", size: 1, etag: "" }]);
  });

  it("rejects unsafe base URLs before parsing hrefs", () => {
    expect(() =>
      parseWebDavPropfind("<d:multistatus />", "https://u:p@dav.example.com/dav", "journal/"),
    ).toThrow("不要包含用户名或密码");
    expect(() =>
      parseWebDavPropfind("<d:multistatus />", "https://dav.example.com/dav?token=inline", "journal/"),
    ).toThrow("不要包含查询参数");
  });
});

describe("WebDavProvider", () => {
  it("rejects unsafe base URLs", () => {
    const http = new FakeHttpClient();
    const make = (baseUrl: string) =>
      new WebDavProvider({
        http,
        baseUrl,
        username: "u",
        password: "p",
      });
    expect(() => make("file:///tmp/dav")).toThrow("仅支持 http:// 或 https://");
    expect(() => make("https://u:p@dav.example.com/dav/AuraScholar")).toThrow(
      "不要包含用户名或密码",
    );
    expect(() => make("https://dav.example.com/dav/AuraScholar#frag")).toThrow(
      "不要包含查询参数",
    );
  });

  it("stops before PUT when creating a parent collection fails", async () => {
    const http = new FakeHttpClient();
    http.responses = [response(201), response(500)];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "u",
      password: "p",
    });

    await expect(provider.put("journal/dev-a/0001-0002.jsonl", textEncoder.encode("{}"))).rejects.toThrow(
      "WebDAV MKCOL journal/dev-a failed: 500",
    );

    expect(http.requests.map((req) => req.method)).toEqual(["MKCOL", "MKCOL"]);
    expect(http.requests.map((req) => req.url)).toEqual([
      "https://dav.example.com/dav/AuraScholar/journal",
      "https://dav.example.com/dav/AuraScholar/journal/dev-a",
    ]);
  });

  it("publishes uploads by moving a complete temp object into place", async () => {
    const http = new FakeHttpClient();
    const body = textEncoder.encode("{}");
    http.responses = [response(201), response(201), response(201), response(201)];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "u",
      password: "p",
    });

    await provider.put("journal/dev-a/0001-0002.jsonl", body);

    expect(http.requests.map((req) => req.method)).toEqual(["MKCOL", "MKCOL", "PUT", "MOVE"]);
    const tempUrl = http.requests[2]?.url ?? "";
    expect(tempUrl).toMatch(
      /^https:\/\/dav\.example\.com\/dav\/AuraScholar\/journal\/dev-a\/\.0001-0002\.jsonl\.aurascholar-upload-[a-z0-9]+-[a-z0-9]+$/,
    );
    expect(http.requests[2]?.body).toBe(body);
    expect(http.requests[3]?.url).toBe(tempUrl);
    expect(http.requests[3]?.headers?.destination).toBe(
      "https://dav.example.com/dav/AuraScholar/journal/dev-a/0001-0002.jsonl",
    );
    expect(http.requests[3]?.headers?.overwrite).toBe("T");
  });

  it("cleans up the temp object when publishing fails", async () => {
    const http = new FakeHttpClient();
    http.responses = [response(201), response(201), response(201), response(507), response(204)];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "u",
      password: "p",
    });

    await expect(
      provider.put("journal/dev-a/0001-0002.jsonl", textEncoder.encode("{}")),
    ).rejects.toThrow("WebDAV MOVE journal/dev-a/0001-0002.jsonl failed: 507");

    expect(http.requests.map((req) => req.method)).toEqual([
      "MKCOL",
      "MKCOL",
      "PUT",
      "MOVE",
      "DELETE",
    ]);
    expect(http.requests[4]?.url).toBe(http.requests[2]?.url);
  });

  it("cleans up the temp object when uploading fails", async () => {
    const http = new FakeHttpClient();
    http.responses = [response(201), response(201), response(500), response(204)];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "u",
      password: "p",
    });

    await expect(
      provider.put("journal/dev-a/0001-0002.jsonl", textEncoder.encode("{}")),
    ).rejects.toThrow("WebDAV PUT journal/dev-a/0001-0002.jsonl failed: 500");

    expect(http.requests.map((req) => req.method)).toEqual(["MKCOL", "MKCOL", "PUT", "DELETE"]);
    expect(http.requests[3]?.url).toBe(http.requests[2]?.url);
    expect(http.requests.some((req) => req.method === "PUT" && req.url.endsWith("/0001-0002.jsonl"))).toBe(
      false,
    );
  });

  it("encodes object path segments without encoding slashes", async () => {
    const http = new FakeHttpClient();
    http.responses = [response(200, "ok")];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar/",
      username: "u",
      password: "p",
    });

    await provider.get("journal/dev a/file#1.jsonl");

    expect(http.requests[0]?.url).toBe(
      "https://dav.example.com/dav/AuraScholar/journal/dev%20a/file%231.jsonl",
    );
  });

  it("rejects remote object paths with traversal segments before sending requests", async () => {
    const http = new FakeHttpClient();
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "u",
      password: "p",
    });

    await expect(provider.get("journal/../secret.jsonl")).rejects.toThrow(
      "不能包含空段、. 或 ..",
    );
    await expect(provider.get("journal//secret.jsonl")).rejects.toThrow(
      "不能包含空段、. 或 ..",
    );
    await expect(
      provider.put("journal//secret.jsonl", textEncoder.encode("{}")),
    ).rejects.toThrow("不能包含空段、. 或 ..");
    await expect(
      provider.put("journal/../secret.jsonl", textEncoder.encode("{}")),
    ).rejects.toThrow("不能包含空段、. 或 ..");
    expect(http.requests).toHaveLength(0);
  });

  it("recursively lists journal segments inside device collections", async () => {
    const http = new FakeHttpClient();
    http.responses = [
      response(
        200,
        `<d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/dav/AuraScholar/journal/</d:href>
            <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
          </d:response>
          <d:response>
            <d:href>/dav/AuraScholar/journal/dev-a/</d:href>
            <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
          </d:response>
        </d:multistatus>`,
      ),
      response(
        200,
        `<d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/dav/AuraScholar/journal/dev-a/</d:href>
            <d:propstat><d:prop><d:resourcetype><d:collection /></d:resourcetype></d:prop></d:propstat>
          </d:response>
          <d:response>
            <d:href>/dav/AuraScholar/journal/dev-a/000000000001-000000000002.jsonl</d:href>
            <d:propstat><d:prop><d:getcontentlength>12</d:getcontentlength><d:getetag>&quot;seg&quot;</d:getetag></d:prop></d:propstat>
          </d:response>
        </d:multistatus>`,
      ),
    ];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "u",
      password: "p",
    });

    await expect(provider.list("journal/")).resolves.toEqual([
      { path: "journal/dev-a/000000000001-000000000002.jsonl", size: 12, etag: '"seg"' },
    ]);
    expect(http.requests.map((req) => req.url)).toEqual([
      "https://dav.example.com/dav/AuraScholar/journal/",
      "https://dav.example.com/dav/AuraScholar/journal/dev-a/",
    ]);
  });

  it("sends non-ASCII credentials as UTF-8 Basic auth", async () => {
    const http = new FakeHttpClient();
    http.responses = [response(200, "<d:multistatus xmlns:d=\"DAV:\" />")];
    const provider = new WebDavProvider({
      http,
      baseUrl: "https://dav.example.com/dav/AuraScholar",
      username: "研究者",
      password: "应用密码",
    });

    await provider.list("journal/");

    expect(http.requests[0]?.headers?.authorization).toBe(
      `Basic ${Buffer.from("研究者:应用密码", "utf8").toString("base64")}`,
    );
  });
});
