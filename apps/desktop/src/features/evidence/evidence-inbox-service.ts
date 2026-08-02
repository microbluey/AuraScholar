import type { EvidenceRecord } from "@aurascholar/db/repos/evidence";
import type { EvidenceInboxItemDto } from "@aurascholar/db/repos/evidence-inbox";
import type { RecoverEvidenceSourceResult } from "../../../electron/shared";
import { isDesktopRuntime } from "../../services/aura-platform";
import {
  getActiveResearchProjectLibraryId,
  listResearchProjects,
} from "../../services/research-projects";
import type { EvidenceSearchFilters } from "./model";

export interface EvidenceProjectOption {
  id: string;
  name: string;
}

export interface EvidenceSearchRequest extends EvidenceSearchFilters {
  limit: number;
  offset: number;
}

export interface EvidenceSearchResult {
  items: EvidenceInboxItemDto[];
  libraryId: string;
  total: number;
}

export interface EvidenceInboxService {
  addToProject(
    libraryId: string,
    evidenceId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  listProjects(signal?: AbortSignal): Promise<EvidenceProjectOption[]>;
  recoverSource(
    libraryId: string,
    evidenceId: string,
    file: File,
    signal?: AbortSignal,
  ): Promise<RecoverEvidenceSourceResult>;
  removeFromProject(
    libraryId: string,
    evidenceId: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  restore(
    libraryId: string,
    evidenceId: string,
    expectedUpdatedAt: number,
    signal?: AbortSignal,
  ): Promise<EvidenceRecord>;
  search(request: EvidenceSearchRequest, signal?: AbortSignal): Promise<EvidenceSearchResult>;
  softDelete(
    libraryId: string,
    evidenceId: string,
    expectedUpdatedAt: number,
    signal?: AbortSignal,
  ): Promise<EvidenceRecord>;
}

const desktopEvidenceInboxService: EvidenceInboxService = {
  async addToProject(libraryId, evidenceId, projectId, signal) {
    signal?.throwIfAborted();
    await window.aura.data.command("evidence.addToProject", { evidenceId, libraryId, projectId });
    signal?.throwIfAborted();
  },
  async listProjects(signal) {
    const projects = await listResearchProjects({ signal });
    return projects
      .filter((project) => project.status === "active")
      .map((project) => ({ id: project.id, name: project.name }));
  },
  async recoverSource(libraryId, evidenceId, file, signal) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal?.throwIfAborted();
    const result = await window.aura.evidence.recoverSource({
      bytes,
      evidenceId,
      fileName: file.name,
      libraryId,
    });
    signal?.throwIfAborted();
    return result;
  },
  async removeFromProject(libraryId, evidenceId, projectId, signal) {
    signal?.throwIfAborted();
    await window.aura.data.command("evidence.removeFromProject", {
      evidenceId,
      libraryId,
      projectId,
    });
    signal?.throwIfAborted();
  },
  async restore(libraryId, evidenceId, expectedUpdatedAt, signal) {
    signal?.throwIfAborted();
    const result = await window.aura.data.command("evidence.restore", {
      evidenceId,
      expectedUpdatedAt,
      libraryId,
    });
    signal?.throwIfAborted();
    return result.evidence;
  },
  async search(request, signal) {
    const libraryId = await getActiveResearchProjectLibraryId({ signal });
    const result = await window.aura.data.command("evidence.search", {
      availabilityStatuses: request.availabilityStatuses,
      canonicalStatuses: request.canonicalStatuses,
      evidenceKinds: request.evidenceKinds,
      libraryId,
      limit: request.limit,
      offset: request.offset,
      query: request.query,
      revisionStatuses: request.revisionStatuses,
      scope: request.scope,
    });
    signal?.throwIfAborted();
    return { items: result.evidence, libraryId, total: result.total };
  },
  async softDelete(libraryId, evidenceId, expectedUpdatedAt, signal) {
    signal?.throwIfAborted();
    const result = await window.aura.data.command("evidence.softDelete", {
      evidenceId,
      expectedUpdatedAt,
      libraryId,
    });
    signal?.throwIfAborted();
    return result.evidence;
  },
};

const PREVIEW_LIBRARY_ID = "library:preview";
const PREVIEW_PROJECTS: EvidenceProjectOption[] = [
  { id: "project:preview-foundation-models", name: "基础模型阅读地图" },
  { id: "project:preview-scientific-ai", name: "AI for Science" },
];
let previewItems = [
  previewEvidence({
    id: "evidence:preview-method",
    kind: "method",
    pageIndex: 2,
    projectId: null,
    text: "Multi-head attention allows the model to jointly attend to information from different representation subspaces.",
    title: "Attention Is All You Need",
  }),
  previewEvidence({
    availability: "relink-required",
    id: "evidence:preview-limitation",
    kind: "limitation",
    pageIndex: 5,
    projectId: "project:preview-foundation-models",
    text: "Performance is constrained by the amount of compute, data, and model parameters available during training.",
    title: "Scaling Laws for Neural Language Models",
  }),
];

const previewEvidenceInboxService: EvidenceInboxService = {
  async addToProject(_libraryId, evidenceId, projectId, signal) {
    await previewCheckpoint(signal);
    const project = PREVIEW_PROJECTS.find((candidate) => candidate.id === projectId);
    previewItems = previewItems.map((item) =>
      item.evidence.id !== evidenceId || !project
        ? item
        : {
            ...item,
            projectMemberships: item.projectMemberships.some(
              (membership) => membership.projectId === projectId,
            )
              ? item.projectMemberships
              : [...item.projectMemberships, { projectId, projectName: project.name }],
          },
    );
  },
  async listProjects(signal) {
    await previewCheckpoint(signal);
    return PREVIEW_PROJECTS;
  },
  async recoverSource(_libraryId, evidenceId, file, signal) {
    await previewCheckpoint(signal);
    previewItems = previewItems.map((item) =>
      item.evidence.id === evidenceId
        ? {
            ...item,
            attachmentId: `attachment:preview:${file.name}`,
            evidence: { ...item.evidence, availabilityStatus: "available" },
          }
        : item,
    );
    const item = previewItems.find((candidate) => candidate.evidence.id === evidenceId)!;
    return {
      attachmentId: item.attachmentId!,
      evidenceId,
      pageIndex: item.pageIndex ?? 0,
      reusedAttachment: false,
      revisionId: item.evidence.revisionId,
      workId: item.evidence.workId,
    };
  },
  async removeFromProject(_libraryId, evidenceId, projectId, signal) {
    await previewCheckpoint(signal);
    previewItems = previewItems.map((item) =>
      item.evidence.id === evidenceId
        ? {
            ...item,
            projectMemberships: item.projectMemberships.filter(
              (membership) => membership.projectId !== projectId,
            ),
          }
        : item,
    );
  },
  async restore(_libraryId, evidenceId, _expectedUpdatedAt, signal) {
    await previewCheckpoint(signal);
    const item = previewItems.find((candidate) => candidate.evidence.id === evidenceId)!;
    const evidence = { ...item.evidence, deletedAt: null, updatedAt: Date.now() };
    previewItems = previewItems.map((candidate) =>
      candidate.evidence.id === evidenceId ? { ...candidate, evidence } : candidate,
    );
    return evidence;
  },
  async search(request, signal) {
    await previewCheckpoint(signal);
    const query = request.query?.toLocaleLowerCase() ?? "";
    const projectId = request.scope.kind === "project" ? request.scope.projectId : null;
    const matches = previewItems.filter((item) => {
      if (item.evidence.deletedAt !== null) return false;
      if (request.scope.kind === "inbox" && item.projectMemberships.length > 0) return false;
      if (
        projectId &&
        !item.projectMemberships.some((membership) => membership.projectId === projectId)
      )
        return false;
      if (request.evidenceKinds && !request.evidenceKinds.includes(item.evidence.evidenceKind))
        return false;
      if (
        request.availabilityStatuses &&
        !request.availabilityStatuses.includes(item.evidence.availabilityStatus)
      )
        return false;
      if (
        request.revisionStatuses &&
        !request.revisionStatuses.includes(item.evidence.revisionStatus)
      )
        return false;
      if (
        request.canonicalStatuses &&
        !request.canonicalStatuses.includes(item.evidence.canonicalStatus)
      )
        return false;
      return (
        !query || `${item.workTitle} ${item.evidence.text}`.toLocaleLowerCase().includes(query)
      );
    });
    return {
      items: matches.slice(request.offset, request.offset + request.limit),
      libraryId: PREVIEW_LIBRARY_ID,
      total: matches.length,
    };
  },
  async softDelete(_libraryId, evidenceId, _expectedUpdatedAt, signal) {
    await previewCheckpoint(signal);
    const item = previewItems.find((candidate) => candidate.evidence.id === evidenceId)!;
    const evidence = { ...item.evidence, deletedAt: Date.now(), updatedAt: Date.now() };
    previewItems = previewItems.map((candidate) =>
      candidate.evidence.id === evidenceId ? { ...candidate, evidence } : candidate,
    );
    return evidence;
  },
};

export function resolveEvidenceInboxService(): EvidenceInboxService {
  return typeof window !== "undefined" && isDesktopRuntime()
    ? desktopEvidenceInboxService
    : previewEvidenceInboxService;
}

function previewEvidence(input: {
  availability?: EvidenceRecord["availabilityStatus"];
  id: string;
  kind: EvidenceRecord["evidenceKind"];
  pageIndex: number;
  projectId: string | null;
  text: string;
  title: string;
}): EvidenceInboxItemDto {
  const timestamp = Date.UTC(2026, 6, 1, 9, 0, 0);
  const project = PREVIEW_PROJECTS.find((candidate) => candidate.id === input.projectId);
  return {
    assetKind: "pdf",
    assetTitle: `${input.title}.pdf`,
    attachmentId: input.availability ? null : `attachment:${input.id}`,
    authorNames: ["A. Researcher", "B. Scholar"],
    evidence: {
      anchor: { kind: "pdf", pageIndex: input.pageIndex, revisionId: `revision:${input.id}` },
      assetId: `asset:${input.id}`,
      availabilityStatus: input.availability ?? "available",
      canonicalStatus: "active",
      createdAt: timestamp,
      deletedAt: null,
      evidenceKind: input.kind,
      id: input.id,
      libraryId: PREVIEW_LIBRARY_ID,
      noteMd: null,
      provenance: { capturedBy: "user" },
      revisionId: `revision:${input.id}`,
      revisionStatus: "current",
      sourceContentHash: `hash:${input.id}`,
      sourceKind: "document",
      tags: [],
      text: input.text,
      title: null,
      updatedAt: timestamp,
      workId: `work:${input.id}`,
    },
    mimeType: "application/pdf",
    pageIndex: input.pageIndex,
    projectMemberships: project ? [{ projectId: project.id, projectName: project.name }] : [],
    revisionNo: 1,
    workTitle: input.title,
    year: 2024,
  };
}

async function previewCheckpoint(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await Promise.resolve();
  signal?.throwIfAborted();
}
