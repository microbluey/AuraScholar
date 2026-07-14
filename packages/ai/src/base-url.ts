export function normalizeHttpBaseUrl(
  label: string,
  value: string | undefined,
  fallback?: string,
): string {
  const raw = (value || fallback || "").trim();
  if (!raw) throw new Error(`${label} 地址不能为空。`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} 地址格式不正确，请使用完整的 http:// 或 https:// 地址。`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} 地址仅支持 http:// 或 https://。`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} 地址不要包含密钥或账号，请使用独立的 API Key 字段。`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} 地址请填写接口根地址，不要包含查询参数或 # 片段。`);
  }
  return url.toString().replace(/\/+$/, "");
}
