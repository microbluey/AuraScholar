export interface ProjectTargetOption {
  description?: string | null;
  id: string;
  name: string;
  updatedAt?: number;
}

export interface ProjectIngressCommandOptions {
  /**
   * Gateways must re-check this signal immediately before crossing their
   * durable-write boundary. Cancellation is advisory after a commit starts;
   * requestId and projectId remain the authoritative write identity.
   */
  signal: AbortSignal;
}

export interface AddWorksToProjectInput {
  projectId: string;
  requestId: string;
  workIds: readonly string[];
}

export interface AddWorksToProjectResult {
  updated: number;
}

export interface CreateProjectForIngressInput {
  name: string;
  requestId: string;
}

/**
 * Feature-owned service port. The concrete desktop adapter can later bind
 * these operations to typed data commands without exposing Repo/SQL/IPC to UI.
 */
export interface ProjectIngressGateway {
  addWorks(
    input: AddWorksToProjectInput,
    options: ProjectIngressCommandOptions,
  ): Promise<AddWorksToProjectResult>;
  createProject(
    input: CreateProjectForIngressInput,
    options: ProjectIngressCommandOptions,
  ): Promise<ProjectTargetOption>;
  listActiveProjects(
    options: ProjectIngressCommandOptions,
  ): Promise<readonly ProjectTargetOption[]>;
  readRecentProjectId(): string | null;
  rememberRecentProjectId(projectId: string): void;
}
