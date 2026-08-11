import { afterEach, describe, expect, it, vi } from "vitest";
import { CH } from "./shared";
import { SMOKE_PRELOAD_ARGUMENT } from "./smoke-mode";

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  off: vi.fn(),
  on: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    off: mocks.off,
    on: mocks.on,
  },
}));

interface SmokeDbApi {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  run(sql: string, params: unknown[]): Promise<number>;
}

interface ExposedAuraApi {
  db?: SmokeDbApi;
}

const originalArgv = [...process.argv];
const originalSmokeMode = process.env.AURASCHOLAR_SMOKE;

afterEach(() => {
  if (originalSmokeMode === undefined) {
    delete process.env.AURASCHOLAR_SMOKE;
  } else {
    process.env.AURASCHOLAR_SMOKE = originalSmokeMode;
  }
  mocks.exposeInMainWorld.mockClear();
  mocks.invoke.mockClear();
  mocks.off.mockClear();
  mocks.on.mockClear();
  process.argv.splice(0, process.argv.length, ...originalArgv);
  vi.resetModules();
});

async function exposeAuraApi(smokeMode: boolean): Promise<ExposedAuraApi> {
  // The preload no longer accepts an environment value as authority. It must
  // receive the marker that only main appends after checking app.isPackaged.
  process.argv.splice(0, process.argv.length, ...originalArgv);
  if (smokeMode) process.argv.push(SMOKE_PRELOAD_ARGUMENT);
  await import("./preload");
  expect(mocks.exposeInMainWorld).toHaveBeenCalledOnce();
  expect(mocks.exposeInMainWorld).toHaveBeenCalledWith("aura", expect.any(Object));
  return mocks.exposeInMainWorld.mock.calls[0]![1] as ExposedAuraApi;
}

describe("preload smoke-only raw database bridge", () => {
  it("does not expose a raw database capability in production", async () => {
    process.env.AURASCHOLAR_SMOKE = "1";
    const api = await exposeAuraApi(false);

    expect(api).not.toHaveProperty("db");
  });

  it("exposes the raw database capability only to the smoke process", async () => {
    const api = await exposeAuraApi(true);

    expect(api.db).toBeDefined();
    await api.db!.query<{ count: number }>("SELECT 1", []);
    expect(mocks.invoke).toHaveBeenCalledWith(CH.dbQuery, "SELECT 1", []);
  });
});
