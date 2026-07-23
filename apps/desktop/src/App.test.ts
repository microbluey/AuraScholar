import { describe, expect, it } from "vitest";
import { resolveAppCommandShortcut } from "./App";

const APPLE_COMMAND_K = {
  key: "k",
  metaKey: true,
};

describe("app command shortcut ownership", () => {
  it("delegates an unopened command palette to the canvas route", () => {
    expect(
      resolveAppCommandShortcut({
        commandOpen: false,
        event: APPLE_COMMAND_K,
        pathname: "/canvas",
        platform: "MacIntel",
      }),
    ).toBe("open-canvas");
    expect(
      resolveAppCommandShortcut({
        commandOpen: false,
        event: APPLE_COMMAND_K,
        pathname: "/canvas/canvas%3Areview",
        platform: "MacIntel",
      }),
    ).toBe("open-canvas");
  });

  it("closes the global palette first even while visiting a canvas", () => {
    expect(
      resolveAppCommandShortcut({
        commandOpen: true,
        event: APPLE_COMMAND_K,
        pathname: "/canvas/canvas%3Areview",
        platform: "MacIntel",
      }),
    ).toBe("close-global");
  });

  it("does not open a command palette over an unrelated modal", () => {
    expect(
      resolveAppCommandShortcut({
        blockingModal: true,
        commandOpen: false,
        event: APPLE_COMMAND_K,
        pathname: "/canvas/canvas%3Areview",
        platform: "MacIntel",
      }),
    ).toBeNull();
  });

  it("still closes the global palette when another modal is reported", () => {
    expect(
      resolveAppCommandShortcut({
        blockingModal: true,
        commandOpen: true,
        event: APPLE_COMMAND_K,
        pathname: "/canvas/canvas%3Areview",
        platform: "MacIntel",
      }),
    ).toBe("close-global");
  });

  it("keeps global command behavior outside canvas routes", () => {
    expect(
      resolveAppCommandShortcut({
        commandOpen: false,
        event: { ctrlKey: true, key: "K" },
        pathname: "/library",
        platform: "Win32",
      }),
    ).toBe("open-global");
    expect(
      resolveAppCommandShortcut({
        commandOpen: false,
        event: APPLE_COMMAND_K,
        pathname: "/canvas-notes",
        platform: "MacIntel",
      }),
    ).toBe("open-global");
  });

  it("ignores handled, repeated, composing, and invalid shortcuts", () => {
    for (const event of [
      { ...APPLE_COMMAND_K, defaultPrevented: true },
      { ...APPLE_COMMAND_K, repeat: true },
      { ...APPLE_COMMAND_K, isComposing: true },
      { ...APPLE_COMMAND_K, keyCode: 229 },
      { ...APPLE_COMMAND_K, shiftKey: true },
      { key: "k", metaKey: false },
    ]) {
      expect(
        resolveAppCommandShortcut({
          commandOpen: false,
          event,
          pathname: "/canvas/canvas%3Areview",
          platform: "MacIntel",
        }),
      ).toBeNull();
    }
  });
});
