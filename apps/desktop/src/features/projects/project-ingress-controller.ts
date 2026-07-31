import type {
  AddWorksToProjectResult,
  ProjectIngressGateway,
  ProjectTargetOption,
} from "./project-ingress-gateway";
import {
  normalizeNewProjectName,
  normalizeProjectIngressRequest,
  normalizeProjectTargets,
  resolveDefaultProjectTargetId,
  type ProjectIngressRequest,
} from "./project-ingress-model";

export interface ProjectIngressDialogState {
  defaultProjectId: string;
  projects: readonly ProjectTargetOption[];
  requestId: string;
  sourceLabel?: string;
  workCount: number;
}

export interface ProjectIngressSnapshot {
  dialog: ProjectIngressDialogState | null;
  pending: boolean;
}

export interface ProjectIngressOpenOptions {
  activeProjectId?: string | null;
  signal?: AbortSignal;
}

export type ProjectIngressOutcome =
  | { status: "added"; projectId: string; updated: number }
  | { status: "cancelled" }
  | { status: "selection-required"; requestId: string };

interface ActiveRequest {
  abortController: AbortController;
  detachCallerAbort: () => void;
  generation: number;
  projects: ProjectTargetOption[];
  request: ReturnType<typeof normalizeProjectIngressRequest>;
  requestId: string;
  showDialog: boolean;
}

const EMPTY_SNAPSHOT: ProjectIngressSnapshot = {
  dialog: null,
  pending: false,
};

let nextRequestNumber = 0;

function nextProjectIngressRequestId(): string {
  nextRequestNumber += 1;
  return `project-ingress:${Date.now()}:${nextRequestNumber}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export class ProjectIngressController {
  private active: ActiveRequest | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private snapshot: ProjectIngressSnapshot = EMPTY_SNAPSHOT;

  constructor(private readonly gateway: ProjectIngressGateway) {}

  readonly getSnapshot = (): ProjectIngressSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async open(
    input: ProjectIngressRequest,
    options: ProjectIngressOpenOptions = {},
  ): Promise<ProjectIngressOutcome> {
    const request = normalizeProjectIngressRequest(input);
    const active = this.begin(request, options.signal);
    if (!this.isCurrent(active)) return { status: "cancelled" };
    this.updateSnapshot(null, true);

    try {
      const projects = normalizeProjectTargets(
        await this.gateway.listActiveProjects({ signal: active.abortController.signal }),
      );
      if (!this.isCurrent(active)) return { status: "cancelled" };
      active.projects = projects;
      const defaultProjectId = resolveDefaultProjectTargetId(
        projects,
        options.activeProjectId,
        this.gateway.readRecentProjectId(),
      );

      if (projects.length === 1) {
        return this.commit(active, projects[0]!.id);
      }

      active.showDialog = true;
      this.updateSnapshot(
        {
          defaultProjectId,
          projects,
          requestId: active.requestId,
          sourceLabel: request.sourceLabel,
          workCount: request.workIds.length,
        },
        false,
      );
      return { status: "selection-required", requestId: active.requestId };
    } catch (error) {
      if (!this.isCurrent(active) || isAbortError(error)) return { status: "cancelled" };
      this.finish(active);
      throw error;
    }
  }

  async confirm(projectId: string): Promise<ProjectIngressOutcome> {
    const active = this.active;
    if (!active || !this.isCurrent(active)) return { status: "cancelled" };
    return this.commit(active, projectId);
  }

  async createProject(nameInput: string): Promise<ProjectTargetOption> {
    const active = this.active;
    if (!active || !active.showDialog || !this.isCurrent(active)) {
      throw new DOMException("Project ingress cancelled", "AbortError");
    }
    const name = normalizeNewProjectName(nameInput);
    this.updateSnapshot(this.dialogState(active), true);
    try {
      const created = normalizeProjectTargets([
        await this.gateway.createProject(
          { name, requestId: active.requestId },
          { signal: active.abortController.signal },
        ),
      ])[0]!;
      if (!this.isCurrent(active)) {
        throw new DOMException("Project ingress cancelled", "AbortError");
      }
      const duplicateIndex = active.projects.findIndex((project) => project.id === created.id);
      active.projects =
        duplicateIndex >= 0
          ? active.projects.map((project, index) => (index === duplicateIndex ? created : project))
          : [...active.projects, created];
      this.updateSnapshot(
        {
          ...this.dialogState(active),
          defaultProjectId: created.id,
        },
        false,
      );
      return created;
    } catch (error) {
      if (this.isCurrent(active)) this.updateSnapshot(this.dialogState(active), false);
      throw error;
    }
  }

  cancel(): void {
    const active = this.active;
    this.generation += 1;
    this.active = null;
    if (active) {
      active.detachCallerAbort();
      active.abortController.abort();
    }
    this.updateSnapshot(null, false);
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private begin(request: ActiveRequest["request"], callerSignal?: AbortSignal): ActiveRequest {
    this.cancel();
    const abortController = new AbortController();
    const generation = ++this.generation;
    const active: ActiveRequest = {
      abortController,
      detachCallerAbort: () => undefined,
      generation,
      projects: [],
      request,
      requestId: nextProjectIngressRequestId(),
      showDialog: false,
    };
    const cancelFromCaller = () => {
      if (this.active === active) this.cancel();
    };
    if (callerSignal) {
      callerSignal.addEventListener("abort", cancelFromCaller, { once: true });
      active.detachCallerAbort = () => callerSignal.removeEventListener("abort", cancelFromCaller);
    }
    this.active = active;
    if (callerSignal?.aborted) this.cancel();
    return active;
  }

  private async commit(active: ActiveRequest, projectId: string): Promise<ProjectIngressOutcome> {
    if (!this.isCurrent(active)) return { status: "cancelled" };
    const target = active.projects.find((project) => project.id === projectId);
    if (!target) throw new Error("所选研究项目已失效，请重新选择。");
    this.updateSnapshot(active.showDialog ? this.dialogState(active) : null, true);
    try {
      const result: AddWorksToProjectResult = await this.gateway.addWorks(
        {
          projectId: target.id,
          requestId: active.requestId,
          workIds: active.request.workIds,
        },
        { signal: active.abortController.signal },
      );
      if (!this.isCurrent(active)) return { status: "cancelled" };
      try {
        this.gateway.rememberRecentProjectId(target.id);
      } catch {
        // Preference storage is best-effort; the durable add already succeeded.
      }
      this.finish(active);
      return { status: "added", projectId: target.id, updated: result.updated };
    } catch (error) {
      if (!this.isCurrent(active) || isAbortError(error)) return { status: "cancelled" };
      this.updateSnapshot(active.showDialog ? this.dialogState(active) : null, false);
      throw error;
    }
  }

  private dialogState(active: ActiveRequest): ProjectIngressDialogState {
    const current = this.snapshot.dialog;
    return {
      defaultProjectId:
        current?.requestId === active.requestId
          ? current.defaultProjectId
          : resolveDefaultProjectTargetId(
              active.projects,
              null,
              this.gateway.readRecentProjectId(),
            ),
      projects: active.projects,
      requestId: active.requestId,
      sourceLabel: active.request.sourceLabel,
      workCount: active.request.workIds.length,
    };
  }

  private finish(active: ActiveRequest): void {
    if (!this.isCurrent(active)) return;
    active.detachCallerAbort();
    this.active = null;
    this.updateSnapshot(null, false);
  }

  private isCurrent(active: ActiveRequest): boolean {
    return (
      this.active === active &&
      this.generation === active.generation &&
      !active.abortController.signal.aborted
    );
  }

  private updateSnapshot(dialog: ProjectIngressDialogState | null, pending: boolean): void {
    this.snapshot = { dialog, pending };
    for (const listener of this.listeners) listener();
  }
}
