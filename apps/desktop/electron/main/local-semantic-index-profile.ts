import type { LocalEmbeddingProfileDescriptor } from "./local-embedding-provider";

export function toProfileInput(descriptor: LocalEmbeddingProfileDescriptor): {
  chunkProfileVersion: string;
  dimension: number;
  distanceMetric: "cosine";
  egressMode: "local";
  fingerprint: string;
  modelId: string;
  modelRevision: string;
  normalization: "l2";
  providerKind: string;
} {
  return { ...descriptor };
}

export function sameProfile(
  stored: {
    chunkProfileVersion: string;
    dimension: number;
    distanceMetric: string;
    egressMode: string;
    fingerprint: string;
    modelId: string;
    modelRevision: string | null;
    normalization: string;
    providerKind: string;
  },
  expected: ReturnType<typeof toProfileInput>,
): boolean {
  return (
    stored.chunkProfileVersion === expected.chunkProfileVersion &&
    stored.dimension === expected.dimension &&
    stored.distanceMetric === expected.distanceMetric &&
    stored.egressMode === expected.egressMode &&
    stored.fingerprint === expected.fingerprint &&
    stored.modelId === expected.modelId &&
    stored.modelRevision === expected.modelRevision &&
    stored.normalization === expected.normalization &&
    stored.providerKind === expected.providerKind
  );
}
