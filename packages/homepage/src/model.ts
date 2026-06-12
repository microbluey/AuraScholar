// Homepage/CV data model — shared between templates, the editor UI, and the
// (future) PDF renderer. Kept storage-agnostic: the app maps cv_profiles +
// works rows into this shape.

export interface ProfilePublication {
  title: string;
  authors: string[];
  venue?: string;
  year?: number;
  doi?: string;
  /** Highlight the profile owner in the author list (exact display-name match). */
  selfName?: string;
  /** e.g. "CCF-A", "Best Paper", "ESI 高被引" — free-form badges. */
  tags?: string[];
}

export interface ProfileLink {
  label: string; // "Google Scholar" | "ORCID" | "GitHub" | ...
  url: string;
}

export interface ProfileSection {
  /** "education" | "experience" | "award" | custom */
  kind: string;
  title: string;
  items: Array<{
    period?: string; // "2021.09 – 至今"
    headline: string; // "清华大学 · 计算机科学与技术 · 博士"
    detail?: string;
  }>;
}

export interface Profile {
  displayName: string;
  /** e.g. "博士研究生 · 某某大学计算机学院" */
  tagline?: string;
  email?: string;
  bioMd?: string;
  links: ProfileLink[];
  publications: ProfilePublication[];
  sections: ProfileSection[];
  /** Template id: "dawn-minimal" | "nocturne-geek" */
  theme: string;
}

/** GB/T 7714-style citation line (simplified, journal articles). */
export function formatGbt7714(pub: ProfilePublication): string {
  const authors = formatAuthorList(pub.authors, 3, ", ", "等");
  const parts = [`${authors}. ${pub.title}`];
  if (pub.venue) parts.push(`[J]. ${pub.venue}`);
  if (pub.year) parts.push(`, ${pub.year}`);
  return parts.join("") + ".";
}

/** APA-ish citation line (simplified). */
export function formatApa(pub: ProfilePublication): string {
  const authors = formatAuthorList(pub.authors, 7, ", ", "et al.");
  const year = pub.year ? ` (${pub.year}).` : ".";
  const venue = pub.venue ? ` ${pub.venue}.` : "";
  return `${authors}${year} ${pub.title}.${venue}`;
}

function formatAuthorList(
  authors: string[],
  max: number,
  sep: string,
  etAl: string,
): string {
  if (authors.length === 0) return "(无作者)";
  if (authors.length <= max) return authors.join(sep);
  return authors.slice(0, max).join(sep) + sep + etAl;
}
