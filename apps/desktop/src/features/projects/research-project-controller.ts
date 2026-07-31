import type { ResearchProjectService } from "../../services/research-project-service";
import {
  describeProjectError,
  isAbortError,
  normalizeResearchProjectName,
  type ResearchProjectBusyAction,
  type ResearchProjectControllerSnapshot,
  type ResearchProjectOperationResult,
  type ResearchProjectWorkspaceData,
} from "./model";

type Listener = () => void;

interface RequestTicket {
  controller: AbortController;
  generation: number;
  lifecycle: number;
  projectId: string | null;
}

const initialSnapshot: ResearchProjectControllerSnapshot = {
  busyAction: null,
  error: null,
  loading: false,
  message: null,
  project: null,
  projects: [],
  requestedProjectId: null,
  sources: [],
};

export class ResearchProjectController {
  private active = false;
  private actionGeneration = 0;
  private actionTicket: RequestTicket | null = null;
  private lifecycle = 0;
  private listeners = new Set<Listener>();
  private loadGeneration = 0;
  private loadTicket: RequestTicket | null = null;
  private snapshot: ResearchProjectControllerSnapshot = initialSnapshot;

  constructor(private readonly service: ResearchProjectService) {}

  readonly getSnapshot = (): ResearchProjectControllerSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lifecycle += 1;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.invalidateLoad();
    this.invalidateAction();
  }

  dismissFeedback(): void {
    this.update({ error: null, message: null });
  }

  loadIndex(): Promise<ResearchProjectOperationResult> {
    return this.runLoad(null, async (ticket) => ({
      project: null,
      projects: await this.service.listProjects({ signal: ticket.controller.signal }),
      sources: [],
    }));
  }

  loadProject(projectId: string): Promise<ResearchProjectOperationResult> {
    const normalizedId = projectId.trim();
    if (!normalizedId) return Promise.resolve(this.failure(new Error("研究项目标识不能为空")));
    return this.runLoad(normalizedId, (ticket) =>
      this.service.loadWorkspace(normalizedId, { signal: ticket.controller.signal }),
    );
  }

  async createProject(name: string): Promise<ResearchProjectOperationResult> {
    const normalizedName = normalizeResearchProjectName(name);
    if (!normalizedName) return this.failure(new Error("请输入项目名称"));
    return this.runAction("create", this.snapshot.requestedProjectId, async (ticket) => {
      const project = await this.service.createProject(normalizedName, undefined, {
        signal: ticket.controller.signal,
      });
      if (!this.isCurrentAction(ticket)) return { status: "stale" };
      this.update({
        projects: [...this.snapshot.projects, project],
        message: `已创建项目“${project.name}”`,
      });
      return { project, status: "completed" };
    });
  }

  async renameProject(name: string): Promise<ResearchProjectOperationResult> {
    const target = this.snapshot.project;
    const normalizedName = normalizeResearchProjectName(name);
    if (!target) return this.failure(new Error("当前项目尚未载入"));
    if (!normalizedName) return this.failure(new Error("请输入项目名称"));
    if (normalizedName === target.name) return { project: target, status: "completed" };

    return this.runAction("rename", target.id, async (ticket) => {
      const renamed = await this.service.renameProject(
        target.id,
        normalizedName,
        target.updatedAt,
        { signal: ticket.controller.signal },
      );
      if (!this.isCurrentAction(ticket) || renamed.id !== target.id) return { status: "stale" };
      this.update({
        project: renamed,
        projects: this.snapshot.projects.map((project) =>
          project.id === renamed.id ? renamed : project,
        ),
        message: `已重命名为“${renamed.name}”`,
      });
      return { project: renamed, status: "completed" };
    });
  }

  async addWorks(workIds: readonly string[]): Promise<ResearchProjectOperationResult> {
    const target = this.snapshot.project;
    const normalizedIds = uniqueIds(workIds);
    if (!target) return this.failure(new Error("当前项目尚未载入"));
    if (normalizedIds.length === 0) return this.failure(new Error("请选择要加入的文献"));

    return this.runAction("add-sources", target.id, async (ticket) => {
      const added = await this.service.addWorks(target.id, normalizedIds, {
        signal: ticket.controller.signal,
      });
      const data = await this.refreshForAction(ticket);
      if (!data) return { status: "stale" };
      this.applyWorkspace(data, target.id);
      this.update({ message: `已将 ${added} 篇文献加入项目` });
      return { status: "completed" };
    });
  }

  async removeWork(workId: string): Promise<ResearchProjectOperationResult> {
    const target = this.snapshot.project;
    const normalizedId = workId.trim();
    if (!target) return this.failure(new Error("当前项目尚未载入"));
    if (!normalizedId) return this.failure(new Error("文献标识不能为空"));

    return this.runAction("remove-source", target.id, async (ticket) => {
      await this.service.removeWorks(target.id, [normalizedId], {
        signal: ticket.controller.signal,
      });
      const data = await this.refreshForAction(ticket);
      if (!data) return { status: "stale" };
      this.applyWorkspace(data, target.id);
      this.update({ message: "已从项目移除；文献库原文与附件保持不变" });
      return { status: "completed" };
    });
  }

  private async runLoad(
    projectId: string | null,
    load: (ticket: RequestTicket) => Promise<ResearchProjectWorkspaceData>,
  ): Promise<ResearchProjectOperationResult> {
    if (!this.active) return { status: "stale" };
    this.invalidateLoad();
    this.invalidateAction();
    const ticket = this.ticket(++this.loadGeneration, projectId);
    this.loadTicket = ticket;
    this.update({
      busyAction: null,
      error: null,
      loading: true,
      message: null,
      project: null,
      requestedProjectId: projectId,
      sources: [],
    });
    try {
      const data = await load(ticket);
      if (!this.isCurrentLoad(ticket)) return { status: "stale" };
      if (data.project && data.project.id !== projectId) {
        throw new Error("研究项目响应与当前路由不一致");
      }
      this.applyWorkspace(data, projectId);
      this.update({ loading: false });
      return { project: data.project ?? undefined, status: "completed" };
    } catch (error) {
      if (!this.isCurrentLoad(ticket) || isAbortError(error)) return { status: "stale" };
      return this.failure(error, { loading: false });
    } finally {
      if (this.loadTicket === ticket) this.loadTicket = null;
    }
  }

  private async runAction(
    action: ResearchProjectBusyAction,
    projectId: string | null,
    operation: (ticket: RequestTicket) => Promise<ResearchProjectOperationResult>,
  ): Promise<ResearchProjectOperationResult> {
    if (!this.active || this.snapshot.busyAction) return { status: "stale" };
    const ticket = this.ticket(++this.actionGeneration, projectId);
    this.actionTicket = ticket;
    this.update({ busyAction: action, error: null, message: null });
    try {
      return await operation(ticket);
    } catch (error) {
      if (!this.isCurrentAction(ticket) || isAbortError(error)) return { status: "stale" };
      return this.failure(error);
    } finally {
      if (this.isCurrentAction(ticket)) this.update({ busyAction: null });
      if (this.actionTicket === ticket) this.actionTicket = null;
    }
  }

  private async refreshForAction(
    ticket: RequestTicket,
  ): Promise<ResearchProjectWorkspaceData | null> {
    if (!ticket.projectId || !this.isCurrentAction(ticket)) return null;
    const data = await this.service.loadWorkspace(ticket.projectId, {
      signal: ticket.controller.signal,
    });
    if (
      !this.isCurrentAction(ticket) ||
      data.project?.id !== ticket.projectId ||
      this.snapshot.requestedProjectId !== ticket.projectId
    ) {
      return null;
    }
    return data;
  }

  private applyWorkspace(
    data: ResearchProjectWorkspaceData,
    requestedProjectId: string | null,
  ): void {
    this.update({
      project: data.project,
      projects: data.projects,
      requestedProjectId,
      sources: data.sources,
    });
  }

  private failure(
    error: unknown,
    patch: Partial<ResearchProjectControllerSnapshot> = {},
  ): ResearchProjectOperationResult {
    const normalized = error instanceof Error ? error : new Error(describeProjectError(error));
    this.update({ ...patch, error: describeProjectError(normalized) });
    return { error: normalized, status: "failed" };
  }

  private ticket(generation: number, projectId: string | null): RequestTicket {
    return {
      controller: new AbortController(),
      generation,
      lifecycle: this.lifecycle,
      projectId,
    };
  }

  private isCurrentLoad(ticket: RequestTicket): boolean {
    return (
      this.active &&
      this.loadTicket === ticket &&
      ticket.lifecycle === this.lifecycle &&
      ticket.generation === this.loadGeneration &&
      ticket.projectId === this.snapshot.requestedProjectId
    );
  }

  private isCurrentAction(ticket: RequestTicket): boolean {
    return (
      this.active &&
      this.actionTicket === ticket &&
      ticket.lifecycle === this.lifecycle &&
      ticket.generation === this.actionGeneration &&
      ticket.projectId === this.snapshot.requestedProjectId
    );
  }

  private invalidateLoad(): void {
    this.loadGeneration += 1;
    this.loadTicket?.controller.abort();
    this.loadTicket = null;
  }

  private invalidateAction(): void {
    this.actionGeneration += 1;
    this.actionTicket?.controller.abort();
    this.actionTicket = null;
  }

  private update(patch: Partial<ResearchProjectControllerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
