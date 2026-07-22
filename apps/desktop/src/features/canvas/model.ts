import {
  CANVAS_SCHEMA_VERSION,
  type AISynthNode,
  type AISynthesisType,
  type CanvasEdge,
  type CanvasEdgeRelation,
  type CanvasNode,
  type CanvasPoint,
  type CanvasWorkspaceDocument,
  type ExcerptNode,
  type GroupNode,
  type IdeaNoteNode,
  type PaperNode,
} from "@aurascholar/core";

export const DEFAULT_CANVAS_WORKSPACE_ID = "canvas:default";
export const CANVAS_STORAGE_KEY = "aurascholar:spatial-canvas:v1";

export interface CanvasLibraryWork {
  abstract: string | null;
  authorNames: string[];
  doi: string | null;
  id: string;
  readingStatus: string;
  title: string;
  venue: string | null;
  year: number | null;
}

export const RELATION_LABELS: Record<CanvasEdgeRelation, string> = {
  cites: "引用",
  supports: "支持",
  contradicts: "反驳",
  extends: "扩展",
  "derived-from": "源自",
  custom: "关联",
};

export const SYNTHESIS_LABELS: Record<AISynthesisType, string> = {
  methodology_matrix: "方法论矩阵",
  contradiction_analysis: "观点支持与冲突",
  research_gap: "研究缺口",
  tldr: "核心综述",
};

export function createCanvasId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createPaperNode(work: CanvasLibraryWork, position: CanvasPoint): PaperNode {
  const now = Date.now();
  return {
    id: createCanvasId(),
    type: "paper",
    position,
    dimensions: { width: 320, height: 278 },
    tags: [],
    createdAt: now,
    updatedAt: now,
    data: {
      workId: work.id,
      title: work.title,
      authors: work.authorNames,
      year: work.year,
      venue: work.venue ?? undefined,
      doi: work.doi ?? undefined,
      abstractSnippet: work.abstract?.trim() || undefined,
      annotationCount: 0,
    },
  };
}

export function createIdeaNoteNode(position: CanvasPoint): IdeaNoteNode {
  const now = Date.now();
  return {
    id: createCanvasId(),
    type: "idea-note",
    position,
    dimensions: { width: 292, height: 196 },
    tags: [],
    createdAt: now,
    updatedAt: now,
    data: {
      title: "研究想法",
      contentMarkdown: "写下一个假设、证据线索或接下来要验证的问题。",
      hasEquations: false,
    },
  };
}

export function createGroupNode(
  position: CanvasPoint,
  dimensions: { height: number; width: number },
): GroupNode {
  const now = Date.now();
  return {
    id: createCanvasId(),
    type: "group",
    position,
    dimensions,
    tags: [],
    createdAt: now,
    updatedAt: now,
    data: { title: "研究主题组", colorTheme: "accent", collapsed: false },
  };
}

export function createAISynthNode(
  sourceNodeIds: string[],
  synthType: AISynthesisType,
  position: CanvasPoint,
): AISynthNode {
  const now = Date.now();
  return {
    id: createCanvasId(),
    type: "ai-synth",
    position,
    dimensions: { width: 320, height: 232 },
    tags: [],
    createdAt: now,
    updatedAt: now,
    data: {
      sourceNodeIds,
      synthType,
      title: `正在整理${SYNTHESIS_LABELS[synthType]}`,
      contentMarkdown: "正在组织所选来源，请稍候…",
    },
  };
}

export function createEdge(
  sourceId: string,
  targetId: string,
  relationType: CanvasEdgeRelation = "custom",
): CanvasEdge {
  const now = Date.now();
  return {
    id: createCanvasId(),
    sourceId,
    targetId,
    relationType,
    label: RELATION_LABELS[relationType],
    createdAt: now,
    updatedAt: now,
  };
}

export function isSynthesisSource(node: CanvasNode): node is PaperNode | ExcerptNode {
  return node.type === "paper" || node.type === "excerpt";
}

function previewPaper(
  id: string,
  title: string,
  authors: string[],
  year: number,
  venue: string,
  abstract: string,
  position: CanvasPoint,
): PaperNode {
  return createPaperNode(
    {
      id,
      title,
      authorNames: authors,
      year,
      venue,
      abstract,
      doi: null,
      readingStatus: "reading",
    },
    position,
  );
}

export const PREVIEW_LIBRARY_WORKS: CanvasLibraryWork[] = [
  {
    id: "preview-knowledge-graphs",
    title: "Knowledge Graphs for Explainable AI",
    authorNames: ["A. Sharma", "L. Chen", "M. Jones"],
    year: 2023,
    venue: "Journal of AI Research",
    doi: "10.5555/preview.kg.xai",
    abstract:
      "A structured account of how knowledge graphs make model reasoning inspectable and context-aware.",
    readingStatus: "reading",
  },
  {
    id: "preview-retrieval",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP",
    authorNames: ["P. Lewis", "E. Perez", "A. Piktus"],
    year: 2020,
    venue: "NeurIPS",
    doi: "10.48550/arXiv.2005.11401",
    abstract:
      "Retrieval-augmented language models combine parametric memory with explicit document evidence.",
    readingStatus: "unread",
  },
  {
    id: "preview-scientific-discovery",
    title: "Augmenting Scientific Discovery with Language Models",
    authorNames: ["M. Bran", "S. Cox"],
    year: 2024,
    venue: "Nature Machine Intelligence",
    doi: null,
    abstract:
      "A review of human-in-the-loop systems for generating and testing scientific hypotheses.",
    readingStatus: "reading",
  },
  {
    id: "preview-causal-reasoning",
    title: "Causal Reasoning over Scholarly Knowledge Graphs",
    authorNames: ["R. Ito", "D. Alvarez"],
    year: 2022,
    venue: "KDD",
    doi: null,
    abstract:
      "A graph-based method for tracing causal claims and conflicting evidence across publications.",
    readingStatus: "unread",
  },
];

export function createPreviewWorkspace(): CanvasWorkspaceDocument {
  const now = Date.now();
  const paper = previewPaper(
    "preview-knowledge-graphs",
    "Knowledge Graphs for Explainable AI",
    ["A. Sharma", "L. Chen", "M. Jones"],
    2023,
    "Journal of AI Research",
    "Knowledge graphs provide structured context for explainable AI, connecting evidence, claims and model decisions.",
    { x: 520, y: 62 },
  );
  const excerpt: ExcerptNode = {
    id: createCanvasId(),
    type: "excerpt",
    position: { x: 92, y: 232 },
    dimensions: { width: 300, height: 208 },
    tags: ["evidence"],
    createdAt: now,
    updatedAt: now,
    data: {
      workId: "preview-knowledge-graphs",
      paperTitle: "Knowledge Graphs for Explainable AI",
      highlightText:
        "Implicit knowledge representation remains a key challenge when researchers need to inspect why a model reached a conclusion.",
      highlightColor: "yellow",
      pageIndex: 8,
      marginNote: "这段可以作为可解释性论证的核心证据。",
    },
  };
  const group: GroupNode = {
    ...createGroupNode({ x: 500, y: 426 }, { width: 720, height: 330 }),
    data: { title: "方法论对比", colorTheme: "accent", collapsed: false },
  };
  const synth: AISynthNode = {
    id: createCanvasId(),
    type: "ai-synth",
    position: { x: 36, y: 54 },
    dimensions: { width: 320, height: 224 },
    groupId: group.id,
    tags: ["synthesis"],
    createdAt: now,
    updatedAt: now,
    data: {
      sourceNodeIds: [paper.id, excerpt.id],
      synthType: "methodology_matrix",
      title: "方法论合成",
      contentMarkdown: "比较所选文献如何组织证据，以及各自对可解释性的约束。",
      structuredTable: {
        headers: ["维度", "观察"],
        rows: [
          ["方法", "结构化知识表示"],
          ["优势", "证据路径清晰"],
          ["局限", "构建与维护成本较高"],
        ],
      },
      modelName: "preview",
    },
  };
  const note: IdeaNoteNode = {
    id: createCanvasId(),
    type: "idea-note",
    position: { x: 400, y: 64 },
    dimensions: { width: 286, height: 204 },
    groupId: group.id,
    tags: ["hypothesis"],
    createdAt: now,
    updatedAt: now,
    data: {
      title: "研究假设",
      contentMarkdown:
        "- 图结构能否暴露模型遗漏的证据？\n- 下一步：比较显式图谱与纯向量检索。\n\n$E(g) = \\sum_v evidence(v)$",
      hasEquations: true,
    },
  };

  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    workspaceId: DEFAULT_CANVAS_WORKSPACE_ID,
    name: "研究空间",
    description: "用于组织文献、证据、合成与研究想法的空间白板。",
    viewport: { x: 6, y: 12, zoom: 0.86 },
    nodes: [group, paper, excerpt, synth, note],
    edges: [
      { ...createEdge(excerpt.id, paper.id, "cites"), label: "引用证据" },
      { ...createEdge(paper.id, synth.id, "derived-from"), label: "合成来源" },
      { ...createEdge(excerpt.id, synth.id, "derived-from"), label: "合成来源" },
      { ...createEdge(note.id, paper.id, "supports"), label: "支持假设" },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
