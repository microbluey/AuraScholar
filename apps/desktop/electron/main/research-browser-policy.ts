const RESEARCH_PROTOCOLS = new Set(["http:", "https:"]);

export function researchPartition(siteId: string): string {
  return `persist:research-${siteId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function validateResearchUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("无效的研究浏览器地址");
  }
  if (!RESEARCH_PROTOCOLS.has(url.protocol)) {
    throw new Error(`研究浏览器不允许打开 ${url.protocol || "未知"} 协议`);
  }
  if (url.username || url.password) {
    throw new Error("研究浏览器地址不能包含用户名或密码");
  }
  return url;
}

export function isAllowedResearchUrl(rawUrl: string): boolean {
  try {
    validateResearchUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
