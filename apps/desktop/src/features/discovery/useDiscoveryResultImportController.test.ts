import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";

type Cleanup = void | (() => void);
type DependencyList = readonly unknown[];

const reactFixture = vi.hoisted(() => {
  type EffectSlot = {
    cleanup?: () => void;
    dependencies?: DependencyList;
    effect?: () => Cleanup;
    kind: "effect";
  };
  type ExternalStoreSlot = {
    kind: "external-store";
    subscribe: (listener: () => void) => () => void;
    unsubscribe: () => void;
  };
  type MemoSlot = {
    dependencies: DependencyList;
    kind: "memo";
    value: unknown;
  };
  type RefSlot = {
    current: unknown;
    kind: "ref";
  };
  type Slot = EffectSlot | ExternalStoreSlot | MemoSlot | RefSlot;

  let component: (() => unknown) | null = null;
  let current: unknown;
  let hookIndex = 0;
  let rendering = false;
  let rerenderQueued = false;
  let slots: Slot[] = [];

  function dependenciesMatch(previous: DependencyList | undefined, next: DependencyList): boolean {
    return (
      previous !== undefined &&
      previous.length === next.length &&
      previous.every((value, index) => Object.is(value, next[index]))
    );
  }

  function render(): void {
    if (!component) throw new Error("Hook fixture is not mounted");
    if (rendering) {
      rerenderQueued = true;
      return;
    }
    rendering = true;
    hookIndex = 0;
    current = component();
    rendering = false;

    for (const slot of slots) {
      if (slot.kind !== "effect" || !slot.effect) continue;
      slot.cleanup?.();
      slot.cleanup = slot.effect() || undefined;
      slot.effect = undefined;
    }
    if (rerenderQueued) {
      rerenderQueued = false;
      render();
    }
  }

  function useRef<Value>(initialValue: Value): { current: Value } {
    const index = hookIndex++;
    let slot = slots[index] as RefSlot | undefined;
    if (!slot) {
      slot = { current: initialValue, kind: "ref" };
      slots[index] = slot;
    }
    return slot as { current: Value };
  }

  function useCallback<Value extends (...args: never[]) => unknown>(
    callback: Value,
    dependencies: DependencyList,
  ): Value {
    const index = hookIndex++;
    const slot = slots[index] as MemoSlot | undefined;
    if (slot && dependenciesMatch(slot.dependencies, dependencies)) {
      return slot.value as Value;
    }
    slots[index] = { dependencies, kind: "memo", value: callback };
    return callback;
  }

  function useEffect(effect: () => Cleanup, dependencies: DependencyList): void {
    const index = hookIndex++;
    const slot = slots[index] as EffectSlot | undefined;
    if (slot && dependenciesMatch(slot.dependencies, dependencies)) return;
    slots[index] = {
      cleanup: slot?.cleanup,
      dependencies,
      effect,
      kind: "effect",
    };
  }

  function useSyncExternalStore<Value>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => Value,
  ): Value {
    const index = hookIndex++;
    const slot = slots[index] as ExternalStoreSlot | undefined;
    if (!slot) {
      slots[index] = {
        kind: "external-store",
        subscribe,
        unsubscribe: subscribe(render),
      };
    } else if (slot.subscribe !== subscribe) {
      slot.unsubscribe();
      slot.subscribe = subscribe;
      slot.unsubscribe = subscribe(render);
    }
    return getSnapshot();
  }

  function reset(): void {
    for (const slot of slots) {
      if (slot.kind === "effect") slot.cleanup?.();
      if (slot.kind === "external-store") slot.unsubscribe();
    }
    component = null;
    current = undefined;
    hookIndex = 0;
    rendering = false;
    rerenderQueued = false;
    slots = [];
  }

  return {
    current<Value>(): Value {
      return current as Value;
    },
    module: {
      useCallback,
      useEffect,
      useRef,
      useSyncExternalStore,
    },
    mount(nextComponent: () => unknown): void {
      reset();
      component = nextComponent;
      render();
    },
    rerender: render,
    reset,
  };
});

const importDiscoveryResult = vi.hoisted(() => vi.fn());

vi.mock("react", () => reactFixture.module);
vi.mock("../../services/discovery", () => ({ importDiscoveryResult }));

import {
  useDiscoveryResultImportController,
  type UseDiscoveryResultImportControllerOptions,
} from "./useDiscoveryResultImportController";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function result(id: string, doi: string): DiscoveryResultWithLibrary {
  return {
    id,
    inLibrary: false,
    matchedSources: ["crossref"],
    score: 1,
    source: "crossref",
    work: {
      authors: [],
      doi,
      source: "crossref",
      title: "One logical paper",
      year: 2026,
    },
  };
}

type HookResult = ReturnType<typeof useDiscoveryResultImportController>;

function callbacks(
  canonicalId: string,
  results: readonly DiscoveryResultWithLibrary[],
): UseDiscoveryResultImportControllerOptions {
  return {
    desktopRuntime: true,
    hasResult: vi.fn(() => true),
    onMessage: vi.fn(),
    results,
    selectResult: vi.fn(),
    updateResultByIdentity: vi.fn(() => canonicalId),
  };
}

describe("useDiscoveryResultImportController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      setTimeout: globalThis.setTimeout,
    });
    importDiscoveryResult.mockReset();
  });

  afterEach(() => {
    reactFixture.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("coalesces alias and canonical imports while applying deferred work through latest callbacks", async () => {
    const pending = deferred<{
      deduped: boolean;
      pdfFetched: boolean;
      title: string;
      workId: string;
    }>();
    importDiscoveryResult.mockReturnValue(pending.promise);
    const alias = result("crossref:alias", "10.1000/shared");
    const canonical = result("openalex:canonical", "10.1000/shared");
    const initial = callbacks("stale-id", [alias]);
    const latest = callbacks(canonical.id, [canonical]);
    let options = initial;

    reactFixture.mount(() => useDiscoveryResultImportController(options));
    const first = reactFixture.current<HookResult>().importResult(alias);
    const duplicate = reactFixture.current<HookResult>().importResult(canonical);

    expect(duplicate).toBe(first);
    expect(reactFixture.current<HookResult>().isImporting(canonical)).toBe(true);

    options = latest;
    reactFixture.rerender();
    pending.resolve({
      deduped: false,
      pdfFetched: true,
      title: alias.work.title,
      workId: "library-work",
    });
    await vi.advanceTimersByTimeAsync(350);

    await expect(first).resolves.toMatchObject({
      status: "applied",
      value: { workId: "library-work" },
    });
    expect(importDiscoveryResult).toHaveBeenCalledOnce();
    expect(importDiscoveryResult).toHaveBeenCalledWith(alias.work);
    expect(initial.hasResult).not.toHaveBeenCalled();
    expect(initial.updateResultByIdentity).not.toHaveBeenCalled();
    expect(initial.selectResult).not.toHaveBeenCalled();
    expect(latest.hasResult).toHaveBeenCalledWith(alias);
    expect(latest.updateResultByIdentity).toHaveBeenCalledWith(alias, expect.any(Function));
    expect(latest.selectResult).toHaveBeenCalledWith(canonical.id);
    expect(latest.onMessage).toHaveBeenCalledWith("文献已入库:One logical paper，开放 PDF 已挂载");

    const updater = vi.mocked(latest.updateResultByIdentity).mock.calls[0]![1];
    expect(updater(canonical)).toMatchObject({
      id: canonical.id,
      inLibrary: true,
      libraryWorkId: "library-work",
      needsFulltext: false,
    });
    expect(reactFixture.current<HookResult>().importing).toBe(false);
  });

  it("applies a committed import when the same paper arrives after a search transition", async () => {
    const pending = deferred<{
      deduped: boolean;
      pdfFetched: boolean;
      title: string;
      workId: string;
    }>();
    importDiscoveryResult.mockReturnValue(pending.promise);
    const alias = result("crossref:alias", "10.1000/shared");
    const canonical = result("openalex:canonical", "10.1000/shared");
    const initial = callbacks(alias.id, [alias]);
    const empty = callbacks("missing", []);
    vi.mocked(empty.hasResult).mockReturnValue(false);
    vi.mocked(empty.updateResultByIdentity).mockReturnValue(null);
    let options = initial;

    reactFixture.mount(() => useDiscoveryResultImportController(options));
    const operation = reactFixture.current<HookResult>().importResult(alias);
    options = empty;
    reactFixture.rerender();

    pending.resolve({
      deduped: false,
      pdfFetched: false,
      title: alias.work.title,
      workId: "library-work",
    });
    await vi.advanceTimersByTimeAsync(350);
    await expect(operation).resolves.toMatchObject({ status: "applied" });
    expect(empty.updateResultByIdentity).not.toHaveBeenCalled();

    const latest = callbacks(canonical.id, [canonical]);
    options = latest;
    reactFixture.rerender();

    expect(latest.updateResultByIdentity).toHaveBeenCalledWith(alias, expect.any(Function));
    expect(latest.selectResult).not.toHaveBeenCalled();
    expect(latest.onMessage).not.toHaveBeenCalled();
    const updater = vi.mocked(latest.updateResultByIdentity).mock.calls[0]![1];
    expect(updater(canonical)).toMatchObject({
      id: canonical.id,
      inLibrary: true,
      libraryWorkId: "library-work",
      needsFulltext: true,
    });
  });
});
