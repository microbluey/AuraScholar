import type {
  CanvasCitationRelation,
  CanvasWorkspaceDocument,
  CitationGraph,
} from "@aurascholar/core";

export interface CanvasCitationPaperIdentity {
  doi?: string | null;
  nodeId: string;
  workId: string;
}

export interface CanvasCitationLayoutRequestSnapshot {
  document: CanvasWorkspaceDocument;
  fingerprint: string;
}

export function normalizeCitationDoi(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let normalized = value.trim();
  normalized = normalized.replace(/^doi\s*:\s*/i, "");
  normalized = normalized.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "");
  normalized = normalized.trim().toLowerCase();
  return normalized || null;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareRelations(left: CanvasCitationRelation, right: CanvasCitationRelation): number {
  return (
    compareText(left.citingWorkId, right.citingWorkId) ||
    compareText(left.citedWorkId, right.citedWorkId)
  );
}

export function mergeCanvasCitationRelations(
  ...sources: ReadonlyArray<readonly CanvasCitationRelation[]>
): CanvasCitationRelation[] {
  const citedByCiting = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const relation of source) {
      if (
        !relation.citingWorkId ||
        !relation.citedWorkId ||
        relation.citingWorkId === relation.citedWorkId
      ) {
        continue;
      }
      const citedWorkIds = citedByCiting.get(relation.citingWorkId) ?? new Set<string>();
      citedWorkIds.add(relation.citedWorkId);
      citedByCiting.set(relation.citingWorkId, citedWorkIds);
    }
  }

  const relations: CanvasCitationRelation[] = [];
  for (const [citingWorkId, citedWorkIds] of citedByCiting) {
    for (const citedWorkId of citedWorkIds) relations.push({ citingWorkId, citedWorkId });
  }
  return relations.sort(compareRelations);
}

export function canvasCitationRelationsFromGraph(
  graph: CitationGraph,
  selectedPapers: readonly CanvasCitationPaperIdentity[],
): CanvasCitationRelation[] {
  const workIdsByDoi = new Map<string, Set<string>>();
  for (const paper of selectedPapers) {
    const doi = normalizeCitationDoi(paper.doi);
    if (!doi || !paper.workId) continue;
    const workIds = workIdsByDoi.get(doi) ?? new Set<string>();
    workIds.add(paper.workId);
    workIdsByDoi.set(doi, workIds);
  }

  const workIdsByGraphNodeId = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const doi = normalizeCitationDoi(node.doi);
    const selectedWorkIds = doi ? workIdsByDoi.get(doi) : undefined;
    if (!selectedWorkIds?.size) continue;
    const workIds = workIdsByGraphNodeId.get(node.id) ?? new Set<string>();
    for (const workId of selectedWorkIds) workIds.add(workId);
    workIdsByGraphNodeId.set(node.id, workIds);
  }

  const relations: CanvasCitationRelation[] = [];
  for (const edge of graph.edges) {
    const citingWorkIds = workIdsByGraphNodeId.get(edge.source);
    const citedWorkIds = workIdsByGraphNodeId.get(edge.target);
    if (!citingWorkIds?.size || !citedWorkIds?.size) continue;
    for (const citingWorkId of citingWorkIds) {
      for (const citedWorkId of citedWorkIds) relations.push({ citingWorkId, citedWorkId });
    }
  }
  return mergeCanvasCitationRelations(relations);
}

export function canvasCitationSelectionFingerprint(
  workspaceId: string,
  selectedPapers: readonly CanvasCitationPaperIdentity[],
): string {
  const identities = selectedPapers
    .map((paper) => ({
      doi: normalizeCitationDoi(paper.doi),
      nodeId: paper.nodeId,
      workId: paper.workId,
    }))
    .sort(
      (left, right) =>
        compareText(left.nodeId, right.nodeId) ||
        compareText(left.workId, right.workId) ||
        compareText(left.doi ?? "", right.doi ?? ""),
    );
  const uniqueIdentities = identities.filter((identity, index) => {
    const previous = identities[index - 1];
    return (
      !previous ||
      identity.nodeId !== previous.nodeId ||
      identity.workId !== previous.workId ||
      identity.doi !== previous.doi
    );
  });
  return JSON.stringify({ workspaceId, papers: uniqueIdentities });
}

export function canvasCitationLayoutRequestMatches(
  request: CanvasCitationLayoutRequestSnapshot,
  currentDocument: CanvasWorkspaceDocument,
  currentFingerprint: string,
): boolean {
  return (
    request.document.workspaceId === currentDocument.workspaceId &&
    request.document.nodes === currentDocument.nodes &&
    request.document.edges === currentDocument.edges &&
    request.fingerprint === currentFingerprint
  );
}
