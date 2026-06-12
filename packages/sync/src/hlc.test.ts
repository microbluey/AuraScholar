import { describe, it, expect } from "vitest";
import { HlcClock, hlcCompare, hlcFromString, hlcToString } from "./hlc";

describe("HlcClock", () => {
  it("produces monotonically increasing timestamps", () => {
    const clock = new HlcClock("dev-a");
    const a = clock.tick();
    const b = clock.tick();
    expect(hlcCompare(a, b)).toBe(-1);
  });

  it("stays monotonic when the wall clock goes backwards", () => {
    let wall = 1000;
    const clock = new HlcClock("dev-a", () => wall);
    const a = clock.tick();
    wall = 500; // clock regression
    const b = clock.tick();
    expect(hlcCompare(a, b)).toBe(-1);
  });

  it("advances past observed remote timestamps", () => {
    let wall = 1000;
    const clock = new HlcClock("dev-a", () => wall);
    const remote = hlcToString({ wallMs: 99999, counter: 3, deviceId: "dev-b" });
    clock.observe(remote);
    const next = clock.tick();
    expect(hlcCompare(remote, next)).toBe(-1);
  });

  it("round-trips through string form", () => {
    const h = { wallMs: 1736000000000, counter: 42, deviceId: "dev-xyz" };
    expect(hlcFromString(hlcToString(h))).toEqual(h);
  });

  it("string ordering matches logical ordering across devices", () => {
    const early = hlcToString({ wallMs: 1000, counter: 99, deviceId: "z" });
    const late = hlcToString({ wallMs: 2000, counter: 0, deviceId: "a" });
    expect(hlcCompare(early, late)).toBe(-1);
  });
});
