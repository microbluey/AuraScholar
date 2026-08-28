import { describe, expect, it, vi } from "vitest";
import { ResearchViewSuspensionLease } from "./research-view-suspension-lease";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("ResearchViewSuspensionLease", () => {
  it("reacquires after an in-flight release before admitting a later confirmation", async () => {
    const firstRelease = deferred<boolean>();
    const acquire = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const release = vi.fn((suspensionId: string) =>
      suspensionId === "first" ? firstRelease.promise : Promise.resolve(true),
    );
    const lease = new ResearchViewSuspensionLease({ acquire, release });

    await expect(lease.acquire()).resolves.toBe(true);
    const closing = lease.release();
    const laterAdmission = lease.acquire();
    expect(lease.blocking).toBe(true);

    firstRelease.resolve(true);
    await expect(closing).resolves.toBe(true);
    await expect(laterAdmission).resolves.toBe(true);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith("first");
    expect(lease.blocking).toBe(true);

    await expect(lease.release()).resolves.toBe(true);
    expect(release).toHaveBeenLastCalledWith("second");
    expect(lease.blocking).toBe(false);
  });

  it("releases a lease that resolves after its UI has disposed", async () => {
    const admission = deferred<string | null>();
    const acquire = vi.fn(() => admission.promise);
    const release = vi.fn().mockResolvedValue(true);
    const lease = new ResearchViewSuspensionLease({ acquire, release });

    const pendingAdmission = lease.acquire();
    const disposing = lease.dispose();
    admission.resolve("late-token");

    await expect(pendingAdmission).resolves.toBe(false);
    await expect(disposing).resolves.toBe(true);
    expect(release).toHaveBeenCalledWith("late-token");
    expect(lease.blocking).toBe(false);
  });

  it("does not discard a later admission when a disposed pending acquire returns no token", async () => {
    const firstAdmission = deferred<string | null>();
    const acquire = vi
      .fn()
      .mockImplementationOnce(() => firstAdmission.promise)
      .mockResolvedValueOnce("next-token");
    const release = vi.fn().mockResolvedValue(true);
    const lease = new ResearchViewSuspensionLease({ acquire, release });

    const pendingAdmission = lease.acquire();
    const disposing = lease.dispose();
    firstAdmission.resolve(null);

    await expect(pendingAdmission).resolves.toBe(false);
    await expect(disposing).resolves.toBe(true);
    await expect(lease.acquire()).resolves.toBe(true);
    expect(release).not.toHaveBeenCalled();
  });
});
