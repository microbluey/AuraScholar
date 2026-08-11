import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSite,
  clearSiteData,
  ezproxyRewrite,
  getEzproxyPrefix,
  getProxyAddress,
  listSites,
  removeSite,
  restoreSite,
  setEzproxyPrefix,
  setHidden,
  setProxyAddress,
  setSiteProxy,
  siteUrl,
  sitesWithData,
  type DiscoverySite,
} from "./discovery-sites";

function site(overrides: Partial<DiscoverySite> = {}): DiscoverySite {
  return {
    builtin: false,
    hidden: false,
    homeUrl: "https://example.edu/",
    id: "custom:site-1",
    name: "Example University",
    searchUrl: "https://example.edu/search?q=",
    sortOrder: 10,
    useProxy: false,
    ...overrides,
  };
}

async function rejectedMessage(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected operation to reject");
}

describe("discovery site data facade", () => {
  const command = vi.fn();
  const clearResearchSiteData = vi.fn();
  const researchSiteData = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      aura: {
        data: { command },
        research: {
          clearSiteData: clearResearchSiteData,
          siteData: researchSiteData,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads sites and the two global settings through typed commands", async () => {
    const sites = [site()];
    command
      .mockResolvedValueOnce({ sites })
      .mockResolvedValueOnce({
        settings: {
          ezproxyPrefix: "https://proxy.example.edu/login?url=",
          proxyAddress: "socks5://127.0.0.1:7890",
        },
      })
      .mockResolvedValueOnce({
        settings: {
          ezproxyPrefix: "https://proxy.example.edu/login?url=",
          proxyAddress: "socks5://127.0.0.1:7890",
        },
      });

    await expect(listSites()).resolves.toEqual(sites);
    await expect(getProxyAddress()).resolves.toBe("socks5://127.0.0.1:7890");
    await expect(getEzproxyPrefix()).resolves.toBe("https://proxy.example.edu/login?url=");

    expect(command).toHaveBeenNthCalledWith(1, "discoverySite.listSites", {});
    expect(command).toHaveBeenNthCalledWith(2, "discoverySite.getSettings", {});
    expect(command).toHaveBeenNthCalledWith(3, "discoverySite.getSettings", {});
  });

  it("routes site and settings mutations through their narrow typed commands", async () => {
    const created = site({ id: "custom:new-site", name: "New site" });
    command.mockResolvedValue({
      created: true,
      site: created,
      status: "created",
    });

    await expect(
      addSite({
        homeUrl: "new.example.edu",
        name: "New site",
        searchUrl: "https://new.example.edu/find?q=",
      }),
    ).resolves.toEqual({ created: true, site: created, status: "created" });
    await expect(setSiteProxy(created.id, true)).resolves.toBeUndefined();
    await expect(setHidden(created.id, true)).resolves.toBeUndefined();
    await expect(removeSite(created.id)).resolves.toBeUndefined();
    await expect(setProxyAddress("socks5://127.0.0.1:7890")).resolves.toBeUndefined();
    await expect(setEzproxyPrefix("https://proxy.example.edu/login?url=")).resolves.toBeUndefined();

    expect(command).toHaveBeenNthCalledWith(1, "discoverySite.addSite", {
      homeUrl: "new.example.edu",
      name: "New site",
      searchUrl: "https://new.example.edu/find?q=",
    });
    expect(command).toHaveBeenNthCalledWith(2, "discoverySite.setSiteProxy", {
      siteId: "custom:new-site",
      useProxy: true,
    });
    expect(command).toHaveBeenNthCalledWith(3, "discoverySite.setSiteHidden", {
      hidden: true,
      siteId: "custom:new-site",
    });
    expect(command).toHaveBeenNthCalledWith(4, "discoverySite.removeSite", {
      siteId: "custom:new-site",
    });
    expect(command).toHaveBeenNthCalledWith(5, "discoverySite.setSettings", {
      proxyAddress: "socks5://127.0.0.1:7890",
    });
    expect(command).toHaveBeenNthCalledWith(6, "discoverySite.setSettings", {
      ezproxyPrefix: "https://proxy.example.edu/login?url=",
    });
  });

  it("keeps main-process URL validation messages usable after Electron wraps command errors", async () => {
    command
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'data:command': Error: 代理地址中不能包含用户名或密码",
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'data:command': Error: 图书馆前缀中不能包含用户名或密码",
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'data:command': Error: 主页 URL 中不能包含用户名或密码",
        ),
      );

    await expect(
      rejectedMessage(() => setProxyAddress("http://user:password@proxy.example.edu")),
    ).resolves.toBe("代理地址中不能包含用户名或密码");
    await expect(
      rejectedMessage(() =>
        setEzproxyPrefix("https://user:password@proxy.example.edu/login?url="),
      ),
    ).resolves.toBe("图书馆前缀中不能包含用户名或密码");
    await expect(
      rejectedMessage(() =>
        addSite({
          homeUrl: "https://user:password@site.example.edu",
          name: "Credentialed site",
        }),
      ),
    ).resolves.toBe("主页 URL 中不能包含用户名或密码");

    expect(command).toHaveBeenNthCalledWith(1, "discoverySite.setSettings", {
      proxyAddress: "http://user:password@proxy.example.edu",
    });
    expect(command).toHaveBeenNthCalledWith(2, "discoverySite.setSettings", {
      ezproxyPrefix: "https://user:password@proxy.example.edu/login?url=",
    });
    expect(command).toHaveBeenNthCalledWith(3, "discoverySite.addSite", {
      homeUrl: "https://user:password@site.example.edu",
      name: "Credentialed site",
    });
  });

  it("restores only a custom snapshot payload and never forwards builtin or hidden flags", async () => {
    const removed = site({ builtin: true, hidden: true, useProxy: true });
    command.mockResolvedValue({ updated: 1 });

    await expect(restoreSite(removed)).resolves.toBeUndefined();

    expect(command).toHaveBeenCalledWith("discoverySite.restoreSite", {
      homeUrl: "https://example.edu/",
      id: "custom:site-1",
      name: "Example University",
      searchUrl: "https://example.edu/search?q=",
      sortOrder: 10,
      useProxy: true,
    });
    const restorePayload = command.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(restorePayload).not.toHaveProperty("builtin");
    expect(restorePayload).not.toHaveProperty("hidden");
  });

  it("keeps research-session cleanup and cookie detection on the renderer bridge", async () => {
    const selected = site();
    researchSiteData.mockResolvedValueOnce([selected.id]);

    await expect(clearSiteData(selected)).resolves.toBeUndefined();
    await expect(sitesWithData([selected.id, "custom:empty"])).resolves.toEqual(
      new Set([selected.id]),
    );
    researchSiteData.mockRejectedValueOnce(new Error("research partition unavailable"));
    await expect(sitesWithData([selected.id])).resolves.toEqual(new Set());
    await expect(sitesWithData([])).resolves.toEqual(new Set());

    expect(clearResearchSiteData).toHaveBeenCalledWith(selected.id);
    expect(researchSiteData).toHaveBeenCalledTimes(2);
    expect(researchSiteData).toHaveBeenNthCalledWith(1, [selected.id, "custom:empty"]);
    expect(command).not.toHaveBeenCalled();
  });

  it("keeps URL helpers pure and fails closed for unsafe rewrite inputs", () => {
    const selected = site();

    expect(siteUrl(selected, " graph neural networks ")).toBe(
      "https://example.edu/search?q=graph%20neural%20networks",
    );
    expect(siteUrl(selected, "")).toBe("https://example.edu/");
    expect(
      ezproxyRewrite(
        "https://proxy.example.edu/login?url=",
        "https://publisher.example.edu/article?id=1",
      ),
    ).toBe(
      "https://proxy.example.edu/login?url=https%3A%2F%2Fpublisher.example.edu%2Farticle%3Fid%3D1",
    );
    expect(
      ezproxyRewrite("https://proxy.example.edu/{url}", "https://publisher.example.edu/article"),
    ).toBe("https://proxy.example.edu/https%3A%2F%2Fpublisher.example.edu%2Farticle");
    expect(
      ezproxyRewrite("https://proxy.example.edu/login?url=", "javascript:alert(1)"),
    ).toBeNull();
    expect(ezproxyRewrite("javascript:{url}", "https://publisher.example.edu/article")).toBeNull();
  });

  it("remains inert outside the desktop runtime", async () => {
    vi.stubGlobal("window", {});

    await expect(listSites()).resolves.toEqual([]);
    await expect(getProxyAddress()).resolves.toBe("");
    await expect(getEzproxyPrefix()).resolves.toBe("");
    await expect(clearSiteData(site())).resolves.toBeUndefined();
    await expect(sitesWithData(["custom:site-1"])).resolves.toEqual(new Set());
    expect(command).not.toHaveBeenCalled();
    expect(clearResearchSiteData).not.toHaveBeenCalled();
    expect(researchSiteData).not.toHaveBeenCalled();
  });
});
