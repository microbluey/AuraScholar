import type { BrowserWindow, Debugger } from "electron";

export const SMOKE_INPUT_REQUEST_PREFIX = "AURASCHOLAR_SMOKE_INPUT ";
export const SMOKE_INPUT_RESULT_EVENT = "aurascholar:smoke-input-result";

const MAX_COORDINATE = 100_000;
const DRAG_HANDSHAKE_DELAY_MS = 180;
const DRAG_RELEASE_DELAY_MS = 32;
const CLICK_PRESS_DELAY_MS = 16;
const DOUBLE_CLICK_DELAY_MS = 40;

type SmokePoint = Readonly<{
  x: number;
  y: number;
}>;

type SmokeInputRequestBase = Readonly<{
  id: string;
}>;

export type SmokeInputRequest = SmokeInputRequestBase &
  (
    | Readonly<{
        kind: "mouse-double-click";
        target: SmokePoint;
      }>
    | Readonly<{
        kind: "mouse-drag";
        source: SmokePoint;
        target: SmokePoint;
        through: SmokePoint;
      }>
  );

function parseRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9:-]{1,80}$/i.test(value)) {
    throw new Error("Smoke input request id is invalid");
  }
  return value;
}

function parsePoint(value: unknown, label: string): SmokePoint {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  const { x, y } = value as Record<string, unknown>;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    x < 0 ||
    x > MAX_COORDINATE ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    y < 0 ||
    y > MAX_COORDINATE
  ) {
    throw new Error(`${label} must contain finite, non-negative viewport coordinates`);
  }
  return { x, y };
}

export function parseSmokeInputRequest(message: string): SmokeInputRequest | null {
  if (!message.startsWith(SMOKE_INPUT_REQUEST_PREFIX)) return null;
  const raw = message.slice(SMOKE_INPUT_REQUEST_PREFIX.length);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Smoke input request must contain valid JSON");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Smoke input request must be an object");
  }
  const request = value as Record<string, unknown>;
  const id = parseRequestId(request.id);
  if (request.kind === "mouse-double-click") {
    return {
      id,
      kind: request.kind,
      target: parsePoint(request.target, "target"),
    };
  }
  if (request.kind === "mouse-drag") {
    return {
      id,
      kind: request.kind,
      source: parsePoint(request.source, "source"),
      target: parsePoint(request.target, "target"),
      through: parsePoint(request.through, "through"),
    };
  }
  throw new Error("Unsupported smoke input request");
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class SmokeInputDriver {
  private attachedByDriver = false;
  private disposed = false;
  private queue = Promise.resolve();

  constructor(private readonly win: BrowserWindow) {}

  async enqueue(message: string): Promise<string | null> {
    if (this.disposed) return null;
    const request = parseSmokeInputRequest(message);
    if (!request) return null;
    const run = this.queue.then(async () => {
      if (this.disposed) return false;
      await this.dispatch(request);
      return true;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return (await run) ? request.id : null;
  }

  async idle(): Promise<void> {
    let pending = this.queue;
    while (true) {
      await pending;
      if (pending === this.queue) return;
      pending = this.queue;
    }
  }

  dispose(): void {
    this.disposed = true;
    const webContents = this.win.webContents;
    if (webContents.isDestroyed()) return;
    const browserDebugger = webContents.debugger;
    try {
      if (this.attachedByDriver && browserDebugger.isAttached()) {
        browserDebugger.detach();
      }
    } catch {
      // The smoke window may already be closing after a timeout or load failure.
    }
    this.attachedByDriver = false;
  }

  private async dispatch(request: SmokeInputRequest): Promise<void> {
    const browserDebugger = this.win.webContents.debugger;
    this.validatePoint(request.target, "target");
    if (request.kind === "mouse-drag") {
      this.validatePoint(request.source, "source");
      this.validatePoint(request.through, "through");
      this.ensureAttached(browserDebugger);
      let pressed = false;
      let lastPoint = request.source;
      try {
        await this.dispatchMouse(browserDebugger, "mouseMoved", request.source, 0);
        await this.dispatchMouse(browserDebugger, "mousePressed", request.source, 1, 1);
        pressed = true;
        lastPoint = request.through;
        await this.dispatchMouse(browserDebugger, "mouseMoved", request.through, 1);
        await wait(DRAG_HANDSHAKE_DELAY_MS);
        lastPoint = request.target;
        await this.dispatchMouse(browserDebugger, "mouseMoved", request.target, 1);
        await wait(DRAG_RELEASE_DELAY_MS);
        await this.dispatchMouse(browserDebugger, "mouseReleased", request.target, 0, 1);
        pressed = false;
      } finally {
        if (pressed) {
          await this.releaseMouse(browserDebugger, lastPoint, 1);
        }
      }
      return;
    }

    this.ensureAttached(browserDebugger);
    let pressed = false;
    let clickCount: 1 | 2 = 1;
    try {
      await this.dispatchMouse(browserDebugger, "mouseMoved", request.target, 0);
      await this.dispatchMouse(browserDebugger, "mousePressed", request.target, 1, clickCount);
      pressed = true;
      await wait(CLICK_PRESS_DELAY_MS);
      await this.dispatchMouse(browserDebugger, "mouseReleased", request.target, 0, clickCount);
      pressed = false;
      await wait(DOUBLE_CLICK_DELAY_MS);
      clickCount = 2;
      await this.dispatchMouse(browserDebugger, "mousePressed", request.target, 1, clickCount);
      pressed = true;
      await wait(CLICK_PRESS_DELAY_MS);
      await this.dispatchMouse(browserDebugger, "mouseReleased", request.target, 0, clickCount);
      pressed = false;
    } finally {
      if (pressed) {
        await this.releaseMouse(browserDebugger, request.target, clickCount);
      }
    }
  }

  private ensureAttached(browserDebugger: Debugger): void {
    if (browserDebugger.isAttached()) return;
    browserDebugger.attach("1.3");
    this.attachedByDriver = true;
  }

  private validatePoint(point: SmokePoint, label: string): void {
    const contentSize = this.win.getContentSize();
    const width = contentSize[0] ?? 0;
    const height = contentSize[1] ?? 0;
    if (point.x >= width || point.y >= height) {
      throw new Error(
        `Smoke input ${label} (${point.x}, ${point.y}) is outside ${width}x${height} content`,
      );
    }
  }

  private async dispatchMouse(
    browserDebugger: Debugger,
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    point: SmokePoint,
    buttons: 0 | 1,
    clickCount?: 1 | 2,
  ): Promise<void> {
    await browserDebugger.sendCommand("Input.dispatchMouseEvent", {
      type,
      x: point.x,
      y: point.y,
      button: buttons === 1 || type === "mouseReleased" ? "left" : "none",
      buttons,
      pointerType: "mouse",
      ...(clickCount ? { clickCount } : {}),
    });
  }

  private async releaseMouse(
    browserDebugger: Debugger,
    point: SmokePoint,
    clickCount: 1 | 2,
  ): Promise<void> {
    try {
      if (!this.win.webContents.isDestroyed() && browserDebugger.isAttached()) {
        await this.dispatchMouse(browserDebugger, "mouseReleased", point, 0, clickCount);
      }
    } catch {
      // Preserve the original input error while best-effort clearing button state.
    }
  }
}
