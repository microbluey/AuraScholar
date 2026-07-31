export function isUniqueConstraint(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    String(candidate.message ?? "").includes("UNIQUE constraint failed")
  );
}
