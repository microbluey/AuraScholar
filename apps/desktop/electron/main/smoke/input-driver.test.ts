import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  parseSmokeInputRequest,
  SmokeInputDriver,
  SMOKE_INPUT_REQUEST_PREFIX,
} from "./input-driver";

function createMockWindow(
  sendCommand = vi.fn(async (_method: string, _params?: Record<string, unknown>) => undefined),
  sendInputEvent = vi.fn((_event: Record<string, unknown>) => undefined),
): {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  sendCommand: typeof sendCommand;
  sendInputEvent: typeof sendInputEvent;
  show: ReturnType<typeof vi.fn>;
  win: BrowserWindow;
} {
  let attached = false;
  let focused = false;
  let visible = false;
  const attach = vi.fn(() => {
    attached = true;
  });
  const detach = vi.fn(() => {
    attached = false;
  });
  const focus = vi.fn(() => {
    focused = true;
  });
  const show = vi.fn(() => {
    visible = true;
  });
  return {
    attach,
    detach,
    focus,
    sendCommand,
    sendInputEvent,
    show,
    win: {
      focus,
      getContentSize: () => [640, 480],
      isFocused: () => focused,
      isVisible: () => visible,
      show,
      webContents: {
        debugger: {
          attach,
          detach,
          isAttached: () => attached,
          sendCommand,
        },
        focus,
        isDestroyed: () => false,
        sendInputEvent,
      },
    } as unknown as BrowserWindow,
  };
}

function inputRequest(id: string, target: Readonly<{ x: number; y: number }>): string {
  return `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
    id,
    kind: "mouse-double-click",
    target,
  })}`;
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("parseSmokeInputRequest", () => {
  it("ignores unrelated console messages", () => {
    expect(parseSmokeInputRequest("ordinary renderer output")).toBeNull();
  });

  it("parses a bounded mouse drag request", () => {
    expect(
      parseSmokeInputRequest(
        `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
          id: "drag:1",
          kind: "mouse-drag",
          source: { x: 10, y: 20 },
          through: { x: 30, y: 40 },
          target: { x: 50, y: 60 },
        })}`,
      ),
    ).toEqual({
      id: "drag:1",
      kind: "mouse-drag",
      source: { x: 10, y: 20 },
      through: { x: 30, y: 40 },
      target: { x: 50, y: 60 },
    });
  });

  it("parses a double-click request", () => {
    expect(
      parseSmokeInputRequest(
        `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
          id: "double-click:1",
          kind: "mouse-double-click",
          target: { x: 75, y: 90 },
        })}`,
      ),
    ).toEqual({
      id: "double-click:1",
      kind: "mouse-double-click",
      target: { x: 75, y: 90 },
    });
  });

  it.each([
    `${SMOKE_INPUT_REQUEST_PREFIX}{`,
    `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({ id: "keyboard:1", kind: "keyboard" })}`,
    `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
      id: "double-click:invalid",
      kind: "mouse-double-click",
      target: { x: -1, y: 10 },
    })}`,
    `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
      id: "drag:invalid",
      kind: "mouse-drag",
      source: { x: 10, y: 20 },
      through: { x: Number.NaN, y: 40 },
      target: { x: 50, y: 60 },
    })}`,
  ])("rejects an invalid request: %s", (message) => {
    expect(() => parseSmokeInputRequest(message)).toThrow();
  });
});

describe("SmokeInputDriver", () => {
  it("surfaces malformed protocol messages as promise rejections", async () => {
    const driver = new SmokeInputDriver({} as never);

    await expect(driver.enqueue(`${SMOKE_INPUT_REQUEST_PREFIX}{`)).rejects.toThrow("valid JSON");
  });

  it("dispatches a trusted double-click sequence in request order", async () => {
    const mock = createMockWindow();
    const driver = new SmokeInputDriver(mock.win);

    await expect(
      driver.enqueue(
        `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
          id: "double-click:sequence",
          kind: "mouse-double-click",
          target: { x: 120, y: 140 },
        })}`,
      ),
    ).resolves.toBe("double-click:sequence");

    expect(mock.attach).toHaveBeenCalledWith("1.3");
    expect(mock.show).toHaveBeenCalledOnce();
    expect(mock.focus).toHaveBeenCalled();
    expect(mock.sendCommand.mock.calls.map(([, params]) => params)).toMatchObject([
      { type: "mouseMoved", buttons: 0 },
      { type: "mousePressed", buttons: 1, clickCount: 1 },
      { type: "mouseReleased", buttons: 0, clickCount: 1 },
      { type: "mousePressed", buttons: 1, clickCount: 2 },
      { type: "mouseReleased", buttons: 0, clickCount: 2 },
    ]);
  });

  it("dispatches a native held-button drag before the connection-handshake move", async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockWindow();
      const driver = new SmokeInputDriver(mock.win);
      const drag = driver.enqueue(
        `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
          id: "drag:sequence",
          kind: "mouse-drag",
          source: { x: 20, y: 30 },
          through: { x: 40, y: 50 },
          target: { x: 100, y: 120 },
        })}`,
      );

      await vi.advanceTimersByTimeAsync(16);
      expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toMatchObject([
        { type: "mouseMove", x: 20, y: 30 },
      ]);
      expect(mock.attach).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(16);
      expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toMatchObject([
        { type: "mouseMove", x: 20, y: 30 },
        {
          type: "mouseDown",
          x: 20,
          y: 30,
          button: "left",
          modifiers: ["leftButtonDown"],
          clickCount: 1,
        },
      ]);

      await vi.advanceTimersByTimeAsync(32);
      expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toMatchObject([
        { type: "mouseMove", x: 20, y: 30 },
        {
          type: "mouseDown",
          x: 20,
          y: 30,
          button: "left",
          modifiers: ["leftButtonDown"],
          clickCount: 1,
        },
        { type: "mouseMove", x: 20, y: 30, modifiers: ["leftButtonDown"] },
      ]);

      await vi.advanceTimersByTimeAsync(16);
      expect(mock.sendInputEvent.mock.calls.map(([event]) => event)).toMatchObject([
        { type: "mouseMove", x: 20, y: 30 },
        {
          type: "mouseDown",
          x: 20,
          y: 30,
          button: "left",
          modifiers: ["leftButtonDown"],
          clickCount: 1,
        },
        { type: "mouseMove", x: 20, y: 30, modifiers: ["leftButtonDown"] },
        { type: "mouseMove", x: 40, y: 50, modifiers: ["leftButtonDown"] },
      ]);

      await vi.runAllTimersAsync();
      await expect(drag).resolves.toBe("drag:sequence");
      const dispatchedEvents = mock.sendInputEvent.mock.calls.map(([event]) => event);
      expect(dispatchedEvents).toHaveLength(6);
      expect(dispatchedEvents).toMatchObject([
        { type: "mouseMove", x: 20, y: 30 },
        {
          type: "mouseDown",
          x: 20,
          y: 30,
          button: "left",
          modifiers: ["leftButtonDown"],
          clickCount: 1,
        },
        { type: "mouseMove", x: 20, y: 30, modifiers: ["leftButtonDown"] },
        { type: "mouseMove", x: 40, y: 50, modifiers: ["leftButtonDown"] },
        { type: "mouseMove", x: 100, y: 120, modifiers: ["leftButtonDown"] },
        { type: "mouseUp", x: 100, y: 120, button: "left", clickCount: 1 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("best-effort releases the mouse when a drag command fails after press", async () => {
    const sendInputEvent = vi.fn((event: Record<string, unknown>) => {
      if (
        event.type === "mouseMove" &&
        Array.isArray(event.modifiers) &&
        event.modifiers.includes("leftButtonDown")
      ) {
        throw new Error("move failed");
      }
    });
    const mock = createMockWindow(undefined, sendInputEvent);
    const driver = new SmokeInputDriver(mock.win);

    await expect(
      driver.enqueue(
        `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
          id: "drag:release-on-error",
          kind: "mouse-drag",
          source: { x: 20, y: 30 },
          through: { x: 40, y: 50 },
          target: { x: 100, y: 120 },
        })}`,
      ),
    ).rejects.toThrow("move failed");

    expect(sendInputEvent.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "mouseUp",
      button: "left",
    });
  });

  it("rejects out-of-bounds coordinates before attaching the debugger", async () => {
    const mock = createMockWindow();
    const driver = new SmokeInputDriver(mock.win);

    await expect(
      driver.enqueue(
        `${SMOKE_INPUT_REQUEST_PREFIX}${JSON.stringify({
          id: "double-click:outside",
          kind: "mouse-double-click",
          target: { x: 640, y: 140 },
        })}`,
      ),
    ).rejects.toThrow("outside");
    expect(mock.attach).not.toHaveBeenCalled();
  });

  it("serializes concurrent requests and keeps idle waiting for appended work", async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const sendCommand = vi.fn(
      async (_method: string, params: Record<string, unknown> | undefined) => {
        if (params?.type !== "mouseMoved") return;
        if (params.x === 100) await firstGate.promise;
        if (params.x === 200) await secondGate.promise;
      },
    );
    const driver = new SmokeInputDriver(createMockWindow(sendCommand).win);
    const first = driver.enqueue(inputRequest("queue:first", { x: 100, y: 100 }));
    let idleCompleted = false;
    const idle = driver.idle().then(() => {
      idleCompleted = true;
    });
    const second = driver.enqueue(inputRequest("queue:second", { x: 200, y: 200 }));

    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(sendCommand.mock.calls[0]?.[1]).toMatchObject({ x: 100 });

    firstGate.resolve();
    await expect(first).resolves.toBe("queue:first");
    await vi.waitFor(() =>
      expect(sendCommand.mock.calls.some(([, params]) => params?.x === 200)).toBe(true),
    );
    expect(idleCompleted).toBe(false);

    secondGate.resolve();
    await expect(second).resolves.toBe("queue:second");
    await idle;
    expect(idleCompleted).toBe(true);
    expect(sendCommand.mock.calls.slice(0, 5).every(([, params]) => params?.x === 100)).toBe(true);
    expect(sendCommand.mock.calls.slice(5).every(([, params]) => params?.x === 200)).toBe(true);
  });

  it("continues queued input after a rejected request", async () => {
    const sendCommand = vi.fn(
      async (_method: string, params: Record<string, unknown> | undefined) => {
        if (params?.x === 100) throw new Error("first request failed");
      },
    );
    const driver = new SmokeInputDriver(createMockWindow(sendCommand).win);
    const first = driver.enqueue(inputRequest("queue:failure", { x: 100, y: 100 }));
    const second = driver.enqueue(inputRequest("queue:recovery", { x: 200, y: 200 }));

    await expect(first).rejects.toThrow("first request failed");
    await expect(second).resolves.toBe("queue:recovery");
    expect(sendCommand.mock.calls.some(([, params]) => params?.x === 200)).toBe(true);
  });

  it("disposes owned debugger state and suppresses queued or future input", async () => {
    const owned = createMockWindow();
    const ownedDriver = new SmokeInputDriver(owned.win);
    await ownedDriver.enqueue(inputRequest("dispose:owned", { x: 100, y: 100 }));
    ownedDriver.dispose();
    expect(owned.detach).toHaveBeenCalledOnce();
    await expect(
      ownedDriver.enqueue(inputRequest("dispose:future", { x: 200, y: 200 })),
    ).resolves.toBeNull();

    const external = createMockWindow();
    external.attach();
    const externalDriver = new SmokeInputDriver(external.win);
    await externalDriver.enqueue(inputRequest("dispose:external", { x: 100, y: 100 }));
    externalDriver.dispose();
    expect(external.detach).not.toHaveBeenCalled();

    const queued = createMockWindow();
    const queuedDriver = new SmokeInputDriver(queued.win);
    const queuedRequest = queuedDriver.enqueue(inputRequest("dispose:queued", { x: 100, y: 100 }));
    queuedDriver.dispose();
    await expect(queuedRequest).resolves.toBeNull();
    expect(queued.sendCommand).not.toHaveBeenCalled();
  });
});
