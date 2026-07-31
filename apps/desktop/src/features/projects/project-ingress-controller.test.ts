import { describe, expect, it, vi } from "vitest";
import type { ProjectIngressGateway, ProjectTargetOption } from "./project-ingress-gateway";
import { ProjectIngressController } from "./project-ingress-controller";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function project(id: string, name = id): ProjectTargetOption {
  return { id, name };
}

function gateway(overrides: Partial<ProjectIngressGateway> = {}): ProjectIngressGateway {
  return {
    addWorks: vi.fn(async () => ({ updated: 1 })),
    createProject: vi.fn(async ({ name }) => project("project-created", name)),
    listActiveProjects: vi.fn(async () => [project("project-a")]),
    readRecentProjectId: vi.fn(() => null),
    rememberRecentProjectId: vi.fn(),
    ...overrides,
  };
}

describe("ProjectIngressController", () => {
  it("adds normalized single or bulk input directly when only one project exists", async () => {
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn(async () => ({ updated: 2 }));
    const rememberRecentProjectId = vi.fn(() => {
      throw new Error("storage unavailable");
    });
    const controller = new ProjectIngressController(gateway({ addWorks, rememberRecentProjectId }));

    await expect(
      controller.open({ sourceLabel: " Paper A ", workIds: [" work-a ", "work-b", "work-a"] }),
    ).resolves.toEqual({ projectId: "project-a", status: "added", updated: 2 });
    expect(addWorks).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-a",
        workIds: ["work-a", "work-b"],
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(rememberRecentProjectId).toHaveBeenCalledWith("project-a");
    expect(controller.getSnapshot()).toEqual({ dialog: null, pending: false });
  });

  it("opens a shared picker for multiple projects and defaults to the active project", async () => {
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn(async () => ({ updated: 1 }));
    const controller = new ProjectIngressController(
      gateway({
        addWorks,
        listActiveProjects: vi.fn(async () => [
          project("project-a", "A"),
          project("project-b", "B"),
        ]),
        readRecentProjectId: vi.fn(() => "project-b"),
      }),
    );

    await expect(
      controller.open(
        { sourceLabel: "Paper A", workIds: ["work-a"] },
        { activeProjectId: "project-a" },
      ),
    ).resolves.toMatchObject({ status: "selection-required" });
    expect(controller.getSnapshot()).toMatchObject({
      dialog: {
        defaultProjectId: "project-a",
        sourceLabel: "Paper A",
        workCount: 1,
      },
      pending: false,
    });
    expect(addWorks).not.toHaveBeenCalled();

    await expect(controller.confirm("project-b")).resolves.toEqual({
      projectId: "project-b",
      status: "added",
      updated: 1,
    });
    expect(addWorks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-b", workIds: ["work-a"] }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("creates a project in place and can immediately confirm it", async () => {
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn(async () => ({ updated: 1 }));
    const createProject: ProjectIngressGateway["createProject"] = vi.fn(async ({ name }) =>
      project("project-new", name),
    );
    const controller = new ProjectIngressController(
      gateway({
        addWorks,
        createProject,
        listActiveProjects: vi.fn(async () => [project("project-a"), project("project-b")]),
      }),
    );

    await controller.open({ workIds: ["work-a"] });
    await expect(controller.createProject("  New   Project ")).resolves.toMatchObject(
      project("project-new", "New Project"),
    );
    expect(controller.getSnapshot().dialog).toMatchObject({
      defaultProjectId: "project-new",
      projects: expect.arrayContaining([
        expect.objectContaining(project("project-new", "New Project")),
      ]),
    });
    await expect(controller.confirm("project-new")).resolves.toMatchObject({
      projectId: "project-new",
      status: "added",
    });
  });

  it("cannot add a stale request after a newer request takes ownership", async () => {
    const firstList = deferred<readonly ProjectTargetOption[]>();
    const secondList = deferred<readonly ProjectTargetOption[]>();
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn(async () => ({ updated: 1 }));
    let call = 0;
    const controller = new ProjectIngressController(
      gateway({
        addWorks,
        listActiveProjects: vi.fn(() => {
          call += 1;
          return call === 1 ? firstList.promise : secondList.promise;
        }),
      }),
    );

    const first = controller.open({ workIds: ["work-old"] });
    const second = controller.open({ workIds: ["work-new"] });
    secondList.resolve([project("project-new")]);
    await expect(second).resolves.toMatchObject({
      projectId: "project-new",
      status: "added",
    });
    firstList.resolve([project("project-old")]);
    await expect(first).resolves.toEqual({ status: "cancelled" });
    expect(addWorks).toHaveBeenCalledTimes(1);
    expect(addWorks).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-new", workIds: ["work-new"] }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps an in-flight old write bound to its original project", async () => {
    const firstAdd = deferred<{ updated: number }>();
    const firstAddStarted = deferred<void>();
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn((input) => {
      if (input.projectId !== "project-old") return Promise.resolve({ updated: 1 });
      firstAddStarted.resolve();
      return firstAdd.promise;
    });
    let call = 0;
    const controller = new ProjectIngressController(
      gateway({
        addWorks,
        listActiveProjects: vi.fn(async () => {
          call += 1;
          return [project(call === 1 ? "project-old" : "project-new")];
        }),
      }),
    );

    const first = controller.open({ workIds: ["work-old"] });
    await firstAddStarted.promise;
    const second = controller.open({ workIds: ["work-new"] });
    await expect(second).resolves.toMatchObject({
      projectId: "project-new",
      status: "added",
    });
    firstAdd.resolve({ updated: 1 });
    await expect(first).resolves.toEqual({ status: "cancelled" });
    expect(addWorks).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ projectId: "project-old", workIds: ["work-old"] }),
      { signal: expect.any(AbortSignal) },
    );
    expect(addWorks).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ projectId: "project-new", workIds: ["work-new"] }),
      { signal: expect.any(AbortSignal) },
    );
  });

  it("cancels pending list and inline creation without a later add", async () => {
    const list = deferred<readonly ProjectTargetOption[]>();
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn(async () => ({ updated: 1 }));
    const firstController = new ProjectIngressController(
      gateway({ addWorks, listActiveProjects: vi.fn(() => list.promise) }),
    );
    const pendingOpen = firstController.open({ workIds: ["work-a"] });
    firstController.cancel();
    list.resolve([project("project-a")]);
    await expect(pendingOpen).resolves.toEqual({ status: "cancelled" });

    const create = deferred<ProjectTargetOption>();
    const secondController = new ProjectIngressController(
      gateway({
        addWorks,
        createProject: vi.fn(() => create.promise),
        listActiveProjects: vi.fn(async () => [project("a"), project("b")]),
      }),
    );
    await secondController.open({ workIds: ["work-b"] });
    const pendingCreate = secondController.createProject("New");
    secondController.cancel();
    create.resolve(project("new", "New"));
    await expect(pendingCreate).rejects.toMatchObject({ name: "AbortError" });
    expect(addWorks).not.toHaveBeenCalled();
  });

  it("honors a caller AbortSignal and rejects invalid targets without writing", async () => {
    const list = deferred<readonly ProjectTargetOption[]>();
    const addWorks: ProjectIngressGateway["addWorks"] = vi.fn(async () => ({ updated: 1 }));
    const controller = new ProjectIngressController(
      gateway({ addWorks, listActiveProjects: vi.fn(() => list.promise) }),
    );
    const abort = new AbortController();
    const pending = controller.open({ workIds: ["work-a"] }, { signal: abort.signal });
    abort.abort();
    list.resolve([project("a"), project("b")]);
    await expect(pending).resolves.toEqual({ status: "cancelled" });

    await controller.open({ workIds: ["work-b"] });
    await expect(controller.confirm("missing")).rejects.toThrow("已失效");
    expect(addWorks).not.toHaveBeenCalled();
  });
});
