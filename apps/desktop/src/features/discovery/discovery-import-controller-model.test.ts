import { describe, expect, it } from "vitest";
import {
  DiscoveryImportLease,
  isSameDiscoveryImportResult,
  toDiscoveryImportError,
} from "./discovery-import-controller-model";

describe("DiscoveryImportLease", () => {
  it("acquires synchronously and only lets the current owner token release", () => {
    const lease = new DiscoveryImportLease<string>();
    const first = lease.tryAcquire("first");

    expect(first).not.toBeNull();
    if (!first) throw new Error("Expected the first lease");
    expect(lease.tryAcquire("second")).toBeNull();
    expect(lease.current).toBe(first);

    expect(lease.release(Symbol("stale") as typeof first.token)).toBe(false);
    expect(lease.current).toBe(first);
    expect(lease.release(first.token)).toBe(true);

    const second = lease.tryAcquire("second");
    expect(second).not.toBeNull();
    expect(lease.release(first.token)).toBe(false);
    expect(lease.current).toBe(second);
  });
});

describe("discovery import model", () => {
  it("compares logical results with either a dependency or a key", () => {
    const byIdentity = {
      isSameResult: (left: { identities: string[] }, right: { identities: string[] }) =>
        left.identities.some((identity) => right.identities.includes(identity)),
      persist: async () => undefined,
    };
    expect(
      isSameDiscoveryImportResult(
        byIdentity,
        { identities: ["doi:paper"] },
        { identities: ["source:id", "doi:paper"] },
      ),
    ).toBe(true);

    const byKey = {
      resultKey: (result: { key: string }) => result.key,
      persist: async () => undefined,
    };
    expect(isSameDiscoveryImportResult(byKey, { key: "paper" }, { key: "paper" })).toBe(true);
    expect(isSameDiscoveryImportResult(byKey, { key: "paper" }, { key: "other" })).toBe(false);
  });

  it("normalizes thrown values and contains a failing normalizer", () => {
    expect(toDiscoveryImportError("failed")).toEqual(new Error("failed"));
    expect(
      toDiscoveryImportError("original", () => {
        throw new Error("normalizer failed");
      }),
    ).toEqual(new Error("normalizer failed"));
  });
});
