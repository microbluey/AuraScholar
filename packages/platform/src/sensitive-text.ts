const REDACTED = "[redacted]";
const URL_REDACTED = "redacted";
const URL_CANDIDATE_RE = /\b(?:https?|socks[45]):\/\/[^\s"'<>]+/gi;

const SECRET_ASSIGNMENT_RE =
  /(["']?)(x[-_ ]?api[-_ ]?key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|id[-_ ]?token|session[-_ ]?token|client[-_ ]?secret|credential|secret|password|passwd)\1(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
const TOKEN_ASSIGNMENT_RE =
  /(^|[\s,{])(["']?)(token)\2(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi;
const AUTHORIZATION_ASSIGNMENT_RE =
  /(["']?)(authorization|proxy[-_ ]?authorization)\1(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic|Digest|NTLM|DeepL-Auth-Key|Api-Key|Token)\s+[^\s,;&}]+|[^\s,;&}]+)/gi;
const COOKIE_HEADER_RE = /\b(set[-_ ]?cookie|cookie)(\s*:\s*)[^\r\n]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BARE_CREDENTIAL_TOKEN_RE =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g;

export function describeSafeError(value: unknown): string {
  if (value instanceof Error) return redactSensitiveText(value.message || value.name);
  if (typeof value === "string") return redactSensitiveText(value);
  if (value == null) return "未知错误";
  try {
    return redactSensitiveText(JSON.stringify(value));
  } catch {
    return redactSensitiveText(String(value));
  }
}

export function toSafeError(value: unknown): Error {
  const error = new Error(describeSafeError(value));
  if (value instanceof Error && value.name && value.name !== "Error") {
    error.name = value.name;
  }
  return error;
}

export function redactSensitiveText(value: string): string {
  return redactAssignments(
    redactAuthorizationHeaders(
      redactBareCredentialTokens(
        redactBearerTokens(redactCookieHeaders(redactUrlCredentials(value))),
      ),
    ),
  );
}

export function redactSensitiveValue(value: unknown, fieldName = ""): unknown {
  if (fieldName && isSensitiveKeyName(fieldName)) return "";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (!isRecord(value)) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    sanitized[key] = redactSensitiveValue(nested, key);
  }
  return sanitized;
}

function redactAssignments(value: string): string {
  return value
    .replace(
      SECRET_ASSIGNMENT_RE,
      (_match, quote: string, key: string, separator: string) =>
        redactAssignment(key, separator, quote),
    )
    .replace(
      TOKEN_ASSIGNMENT_RE,
      (_match, prefix: string, quote: string, key: string, separator: string) =>
        `${prefix}${redactAssignment(key, separator, quote)}`,
    );
}

function redactAuthorizationHeaders(value: string): string {
  return value.replace(
    AUTHORIZATION_ASSIGNMENT_RE,
    (_match, quote: string, key: string, separator: string) =>
      redactAssignment(key, separator, quote),
  );
}

function redactCookieHeaders(value: string): string {
  return value.replace(COOKIE_HEADER_RE, (_match, key: string, separator: string) =>
    `${key}${separator}${REDACTED}`,
  );
}

function redactAssignment(key: string, separator: string, quote: string): string {
  const normalizedSeparator = separator.includes(":") ? ": " : "=";
  const value = quote ? `${quote}${REDACTED}${quote}` : REDACTED;
  return `${quote}${key}${quote}${normalizedSeparator}${value}`;
}

function redactBearerTokens(value: string): string {
  return value.replace(BEARER_RE, `Bearer ${REDACTED}`);
}

function redactBareCredentialTokens(value: string): string {
  return value.replace(BARE_CREDENTIAL_TOKEN_RE, REDACTED);
}

function redactUrlCredentials(value: string): string {
  const asUrl = redactSingleUrl(value);
  if (asUrl !== value) return asUrl;
  return value.replace(URL_CANDIDATE_RE, (candidate) => redactSingleUrl(candidate));
}

function redactSingleUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (!["http:", "https:", "socks4:", "socks5:"].includes(parsed.protocol)) return value;
  if (parsed.username || parsed.password) {
    parsed.username = "";
    parsed.password = "";
  }
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (isSensitiveKeyName(key)) parsed.searchParams.set(key, URL_REDACTED);
  }
  return parsed.toString();
}

export function isSensitiveKeyName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("passwd") ||
    normalized.includes("apikey") ||
    normalized.includes("accesstoken") ||
    normalized.includes("refreshtoken") ||
    normalized.includes("credential") ||
    normalized.includes("cookie") ||
    normalized.includes("session") ||
    normalized === "token" ||
    normalized === "jwt" ||
    normalized.endsWith("token")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
