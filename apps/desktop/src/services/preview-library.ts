import type { ReadingStatus } from "@aurascholar/db";

export interface PreviewLibraryWorkSeed {
  abstract: string;
  arxivId?: string | null;
  authors: string[];
  createdOffset: number;
  doi?: string | null;
  id: string;
  readingStatus: ReadingStatus;
  starred?: boolean;
  title: string;
  type?: string;
  venue: string;
  year: number;
}

/** Canonical browser-preview records shared by Library and cross-page Canvas ingress. */
export const PREVIEW_LIBRARY_WORK_SEEDS: PreviewLibraryWorkSeed[] = [
  {
    id: "preview-attention",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    year: 2017,
    venue: "NeurIPS",
    doi: "10.48550/arXiv.1706.03762",
    arxivId: "1706.03762",
    readingStatus: "reading",
    starred: true,
    createdOffset: 1000 * 60 * 60 * 6,
    abstract:
      "The Transformer replaces recurrent sequence models with attention-only blocks, creating a faster and more parallelizable architecture for machine translation and later foundation models.",
  },
  {
    id: "preview-alphafold",
    title: "Highly accurate protein structure prediction with AlphaFold",
    authors: ["John Jumper", "Richard Evans", "Alexander Pritzel", "Tim Green"],
    year: 2021,
    venue: "Nature",
    doi: "10.1038/s41586-021-03819-2",
    readingStatus: "read",
    createdOffset: 1000 * 60 * 60 * 28,
    abstract:
      "AlphaFold demonstrates near-experimental accuracy for protein structure prediction and shows how deep learning can change structural biology workflows.",
  },
  {
    id: "preview-sam",
    title: "Segment Anything",
    authors: ["Alexander Kirillov", "Eric Mintun", "Nikhila Ravi", "Hanzi Mao"],
    year: 2023,
    venue: "ICCV",
    arxivId: "2304.02643",
    readingStatus: "unread",
    createdOffset: 1000 * 60 * 60 * 52,
    abstract:
      "Segment Anything introduces a promptable segmentation model and a large-scale dataset for broad zero-shot image segmentation use cases.",
  },
  {
    id: "preview-scaling-laws",
    title: "Scaling Laws for Neural Language Models",
    authors: ["Jared Kaplan", "Sam McCandlish", "Tom Henighan", "Tom B. Brown"],
    year: 2020,
    venue: "arXiv",
    arxivId: "2001.08361",
    readingStatus: "reading",
    createdOffset: 1000 * 60 * 60 * 80,
    abstract:
      "This work studies predictable power-law relationships between model size, dataset size, compute, and language-model performance.",
  },
];
