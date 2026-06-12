import { describe, it, expect } from "vitest";
import { newId, workFingerprint, normalizeDoi } from "./ids";

describe("newId", () => {
  it("generates time-ordered unique ids", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });
});

describe("normalizeDoi", () => {
  it("strips doi.org URL prefixes", () => {
    expect(normalizeDoi("https://doi.org/10.1038/s41586-021-03819-2")).toBe(
      "10.1038/s41586-021-03819-2",
    );
    expect(normalizeDoi("https://dx.doi.org/10.1000/XYZ")).toBe("10.1000/xyz");
  });
  it("strips doi: prefix and lowercases", () => {
    expect(normalizeDoi("doi: 10.1109/TPAMI.2020.1234")).toBe("10.1109/tpami.2020.1234");
  });
  it("rejects non-DOI input", () => {
    expect(normalizeDoi("not a doi")).toBeNull();
    expect(normalizeDoi("10.x/incomplete")).toBeNull();
  });
});

describe("workFingerprint", () => {
  it("is stable under case, punctuation and accent differences", () => {
    const a = workFingerprint("Attention Is All You Need!", 2017, "Vaswani");
    const b = workFingerprint("attention is all you need", 2017, "vaswani");
    expect(a).toBe(b);
  });
  it("differs by year", () => {
    expect(workFingerprint("Same Title", 2020, "li")).not.toBe(
      workFingerprint("Same Title", 2021, "li"),
    );
  });
  it("handles CJK titles", () => {
    const fp = workFingerprint("深度学习综述", 2023, "张");
    expect(fp).toContain("深度学习综述");
    expect(fp).toContain("张");
  });
});
