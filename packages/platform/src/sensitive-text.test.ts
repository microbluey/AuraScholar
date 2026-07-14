import { describe, expect, it } from "vitest";
import {
  describeSafeError,
  isSensitiveKeyName,
  redactSensitiveText,
  redactSensitiveValue,
  toSafeError,
} from "./sensitive-text";

describe("sensitive text redaction", () => {
  it("redacts bearer tokens and authorization assignments", () => {
    const text = `request failed Authorization: Bearer sk-live-secret and Bearer abc.def-123`;

    expect(redactSensitiveText(text)).toBe(
      "request failed Authorization: [redacted] and Bearer [redacted]",
    );
  });

  it("redacts secret-like object keys without dropping context", () => {
    const text = `{"apiKey":"sk-test","access_token":"tok","message":"quota exceeded"}`;

    expect(redactSensitiveText(text)).toBe(
      `{"apiKey": "[redacted]","access_token": "[redacted]","message":"quota exceeded"}`,
    );
  });

  it("redacts common HTTP and OAuth credential fields", () => {
    const text = [
      "x-api-key: provider-secret",
      "Proxy-Authorization: Basic dXNlcjpwYXNz",
      "Authorization: DeepL-Auth-Key deepl-secret",
      `{"client_secret":"oauth-secret","id_token":"jwt","session_token":"session"}`,
    ].join("\n");

    expect(redactSensitiveText(text)).toBe(
      [
        "x-api-key: [redacted]",
        "Proxy-Authorization: [redacted]",
        "Authorization: [redacted]",
        `{"client_secret": "[redacted]","id_token": "[redacted]","session_token": "[redacted]"}`,
      ].join("\n"),
    );
  });

  it("redacts common bare credential tokens in provider messages", () => {
    const text = [
      "OpenAI rejected sk-live-openai-secret",
      "Google key AIzaSyD_longProviderKey_123456789",
      "GitHub token ghp_abcdefghijklmnopqrstuvwxyz123456",
      "Slack token xoxb-1234567890-secret-token",
      "Keep placeholder sk-... visible enough for UI hints",
    ].join("\n");

    expect(redactSensitiveText(text)).toBe(
      [
        "OpenAI rejected [redacted]",
        "Google key [redacted]",
        "GitHub token [redacted]",
        "Slack token [redacted]",
        "Keep placeholder sk-... visible enough for UI hints",
      ].join("\n"),
    );
  });

  it("redacts bare credential tokens when describing errors", () => {
    expect(describeSafeError(new Error("Incorrect API key provided: sk-live-provider-secret"))).toBe(
      "Incorrect API key provided: [redacted]",
    );
  });

  it("redacts cookie headers as a whole", () => {
    const text = "Set-Cookie: sid=secret; Path=/; HttpOnly\nCookie: sid=secret; theme=dark";

    expect(redactSensitiveText(text)).toBe("Set-Cookie: [redacted]\nCookie: [redacted]");
  });

  it("redacts URL user info and sensitive query params", () => {
    const text =
      "PROPFIND https://alice:hunter2@example.com/dav?token=abc&session_id=s&folder=library";

    expect(redactSensitiveText(text)).toBe(
      "PROPFIND https://example.com/dav?token=redacted&session_id=redacted&folder=library",
    );
  });

  it("describes unknown thrown values safely", () => {
    const error = new Error("upstream password=secret failed");

    expect(describeSafeError(error)).toBe("upstream password=[redacted] failed");
    expect(describeSafeError({ refreshToken: "secret", code: "E_AUTH" })).toBe(
      `{"refreshToken": "[redacted]","code":"E_AUTH"}`,
    );
  });

  it("preserves custom error names when wrapping", () => {
    const error = new TypeError("Bearer secret-token");
    const safe = toSafeError(error);

    expect(safe.name).toBe("TypeError");
    expect(safe.message).toBe("Bearer [redacted]");
  });

  it("classifies sensitive field names for backup and query filtering", () => {
    expect(isSensitiveKeyName("client_secret")).toBe(true);
    expect(isSensitiveKeyName("id_token")).toBe(true);
    expect(isSensitiveKeyName("session_id")).toBe(true);
    expect(isSensitiveKeyName("Cookie")).toBe(true);
    expect(isSensitiveKeyName("theme")).toBe(false);
    expect(isSensitiveKeyName("folder")).toBe(false);
  });

  it("redacts structured values by field name and string content", () => {
    expect(
      redactSensitiveValue({
        label: "safe",
        nested: {
          client_secret: "secret",
          cookie: "session-cookie",
          sourceUrl: "https://user:pass@example.test/path?session_id=s&folder=ok",
        },
      }),
    ).toEqual({
      label: "safe",
      nested: {
        client_secret: "",
        cookie: "",
        sourceUrl: "https://example.test/path?session_id=redacted&folder=ok",
      },
    });
  });
});
