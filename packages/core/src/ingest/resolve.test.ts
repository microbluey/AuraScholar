import type { ConnectorContext, NormalizedWork } from "@aurascholar/connectors";
import { StubHttpClient, jsonResponse } from "@aurascholar/platform";
import { describe, expect, it } from "vitest";
import { findOaPdf, findOaPdfCandidates } from "./resolve";

function work(overrides: Partial<NormalizedWork> = {}): NormalizedWork {
  return {
    title: "Fallback-aware open access",
    authors: [],
    source: "openalex",
    ...overrides,
  };
}

function context(unpaywallPdfUrl?: string): ConnectorContext {
  const http = new StubHttpClient().on(/api\.unpaywall\.org/, () =>
    jsonResponse(200, {
      is_oa: Boolean(unpaywallPdfUrl),
      best_oa_location: unpaywallPdfUrl
        ? {
            url_for_pdf: unpaywallPdfUrl,
            version: "publishedVersion",
            license: "cc-by",
          }
        : undefined,
    }),
  );
  return {
    mailto: "test@example.test",
    http,
  };
}

describe("findOaPdfCandidates", () => {
  it("returns candidates in Unpaywall, arXiv, then work OA URL order", async () => {
    const candidates = await findOaPdfCandidates(
      context("https://repository.example.test/unpaywall.pdf"),
      work({
        doi: "10.1000/fallback",
        arxivId: "2607.01234",
        oaPdfUrl: "https://publisher.example.test/article/open-access.pdf",
      }),
    );

    expect(candidates).toEqual([
      { url: "https://repository.example.test/unpaywall.pdf", via: "unpaywall" },
      { url: "https://arxiv.org/pdf/2607.01234", via: "arxiv" },
      {
        url: "https://publisher.example.test/article/open-access.pdf",
        via: "openalex",
      },
    ]);
    await expect(
      findOaPdf(
        context("https://repository.example.test/unpaywall.pdf"),
        work({ doi: "10.1000/fallback", arxivId: "2607.01234" }),
      ),
    ).resolves.toEqual({
      url: "https://repository.example.test/unpaywall.pdf",
      via: "unpaywall",
    });
  });

  it("deduplicates URLs while keeping the highest-priority source", async () => {
    const candidates = await findOaPdfCandidates(
      context("https://arxiv.org/pdf/2607.01234.pdf"),
      work({
        doi: "10.1000/duplicate",
        arxivId: "2607.01234",
        oaPdfUrl: "https://arxiv.org/pdf/2607.01234",
      }),
    );

    expect(candidates).toEqual([{ url: "https://arxiv.org/pdf/2607.01234.pdf", via: "unpaywall" }]);
  });

  it("keeps an explicit tokenized OA PDF endpoint for byte-level validation", async () => {
    const tokenized = "https://repository.example.test/download?id=paper-1&token=short-lived";
    const candidates = await findOaPdfCandidates(
      context(),
      work({ oaPdfUrl: tokenized }),
    );

    expect(candidates).toEqual([{ url: tokenized, via: "openalex" }]);
    await expect(
      findOaPdf(context(), work({ oaPdfUrl: tokenized })),
    ).resolves.toEqual({ url: tokenized, via: "openalex" });
  });
});
