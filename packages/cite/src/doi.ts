export function normalizeDoi(rawDoi: string): string | null {
  const normalized = rawDoi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  if (!/^10\.\d{4,9}\/\S+$/.test(normalized)) return null;
  if (hasUnsafeDoiCharacter(normalized)) return null;
  return normalized;
}

export function normalizedDoiUrl(rawDoi: string): string | null {
  const normalized = normalizeDoi(rawDoi);
  if (!normalized) return null;
  const url = new URL("https://doi.org/");
  url.pathname = normalized;
  return url.toString();
}

function hasUnsafeDoiCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return (
      code <= 0x1f || code === 0x7f || char === "<" || char === ">" || char === '"' || char === "'"
    );
  });
}
