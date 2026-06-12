// arXiv API — metadata + guaranteed-legal PDF for preprints.
// Atom XML response, parsed with regex to avoid an XML dependency.
import { getRaw, type ConnectorContext } from "./client";
import type { NormalizedWork } from "./types";

const ARXIV_ID_RE = /(?:arxiv[:/])?(\d{4}\.\d{4,5})(v\d+)?/i;

export function parseArxivId(input: string): string | null {
  const m = input.match(ARXIV_ID_RE);
  return m ? m[1]! : null;
}

export function arxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}`;
}

export async function arxivByid(
  ctx: ConnectorContext,
  arxivId: string,
): Promise<NormalizedWork | null> {
  const res = await getRaw(ctx, `https://export.arxiv.org/api/query?id_list=${arxivId}`);
  const xml = new TextDecoder().decode(res.body);
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry || /<title>Error<\/title>/.test(entry)) return null;

  const text = (tag: string) =>
    entry
      .match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]
      ?.replace(/\s+/g, " ")
      .trim();
  const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m, i) => ({
    displayName: m[1]!.trim(),
    position: i,
  }));
  const published = text("published"); // e.g. 2017-06-12T17:57:34Z
  const doi = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/)?.[1]?.toLowerCase();

  return {
    doi,
    title: text("title") ?? "(untitled)",
    abstract: text("summary"),
    year: published ? Number(published.slice(0, 4)) : undefined,
    publicationDate: published?.slice(0, 10),
    venueName: "arXiv",
    venueType: "repository",
    type: "preprint",
    arxivId,
    authors,
    oaPdfUrl: arxivPdfUrl(arxivId),
    source: "arxiv",
  };
}
