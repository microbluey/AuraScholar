import type { ResearchProjectService } from "../../services/research-project-service";
import {
  describeProjectError,
  isAbortError,
  reconcileProjectSourceSelection,
  toggleProjectSourceSelection,
  type ProjectLibraryWorkOption,
  type ProjectSourceSearchSnapshot,
} from "./model";

type Listener = () => void;

interface SearchTicket {
  controller: AbortController;
  generation: number;
  lifecycle: number;
  projectId: string;
  query: string;
}

const EMPTY_SELECTION = new Set<string>();

export class ProjectSourceSearchController {
  private active = false;
  private generation = 0;
  private lifecycle = 0;
  private listeners = new Set<Listener>();
  private snapshot: ProjectSourceSearchSnapshot = {
    error: null,
    loading: false,
    projectId: "",
    query: "",
    results: [],
    selectedIds: EMPTY_SELECTION,
  };
  private ticket: SearchTicket | null = null;

  constructor(private readonly service: ResearchProjectService) {}

  readonly getSnapshot = (): ProjectSourceSearchSnapshot => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(projectId: string): void {
    if (this.active && this.snapshot.projectId === projectId) return;
    this.stop();
    this.active = true;
    this.lifecycle += 1;
    this.snapshot = {
      error: null,
      loading: false,
      projectId,
      query: "",
      results: [],
      selectedIds: EMPTY_SELECTION,
    };
    this.emit();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.lifecycle += 1;
    this.invalidate();
  }

  search(query: string): Promise<void> {
    if (!this.active || !this.snapshot.projectId) return Promise.resolve();
    this.invalidate();
    const ticket: SearchTicket = {
      controller: new AbortController(),
      generation: ++this.generation,
      lifecycle: this.lifecycle,
      projectId: this.snapshot.projectId,
      query,
    };
    this.ticket = ticket;
    this.update({ error: null, loading: true, query });
    return this.execute(ticket);
  }

  toggle(work: ProjectLibraryWorkOption, selected: boolean): void {
    if (work.inProject) return;
    this.update({
      selectedIds: toggleProjectSourceSelection(this.snapshot.selectedIds, work.workId, selected),
    });
  }

  clearSelection(): void {
    if (this.snapshot.selectedIds.size === 0) return;
    this.update({ selectedIds: EMPTY_SELECTION });
  }

  private async execute(ticket: SearchTicket): Promise<void> {
    try {
      const results = await this.service.searchLibraryWorks(ticket.projectId, ticket.query, {
        signal: ticket.controller.signal,
      });
      if (!this.isCurrent(ticket)) return;
      this.update({
        loading: false,
        results,
        selectedIds: reconcileProjectSourceSelection(this.snapshot.selectedIds, results),
      });
    } catch (error) {
      if (!this.isCurrent(ticket) || isAbortError(error)) return;
      this.update({ error: describeProjectError(error), loading: false, results: [] });
    } finally {
      if (this.ticket === ticket) this.ticket = null;
    }
  }

  private isCurrent(ticket: SearchTicket): boolean {
    return (
      this.active &&
      this.ticket === ticket &&
      ticket.generation === this.generation &&
      ticket.lifecycle === this.lifecycle &&
      ticket.projectId === this.snapshot.projectId &&
      ticket.query === this.snapshot.query
    );
  }

  private invalidate(): void {
    this.generation += 1;
    this.ticket?.controller.abort();
    this.ticket = null;
  }

  private update(patch: Partial<ProjectSourceSearchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
