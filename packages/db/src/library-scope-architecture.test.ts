import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PRODUCTION_ROOTS = [
  resolve(REPOSITORY_ROOT, "apps/desktop/src"),
  resolve(REPOSITORY_ROOT, "apps/desktop/electron"),
];

const LIBRARY_SCOPED_REPOS = new Set([
  "WorksRepo",
  "CollectionsRepo",
  "TagsRepo",
  "CanvasRepo",
  "SavedSearchesRepo",
  "SentinelRepo",
]);

const ROOT_TABLE_SQL =
  /\b(?:from|join|update|into|delete\s+from)\s+(?:works|authors|collections|tags|saved_searches|canvas_workspaces|sentinel_tasks|ai_jobs|derived_artifacts)\b/i;

function productionSourceFiles(): string[] {
  const files: string[] = [];

  const visit = (path: string) => {
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path)) visit(resolve(path, entry));
      return;
    }
    if (!/\.[cm]?tsx?$/.test(path)) return;
    if (/\.(?:test|spec)\.[cm]?tsx?$/.test(path)) return;
    if (path.endsWith("/electron/main/smoke.ts")) return;
    files.push(path);
  };

  for (const root of PRODUCTION_ROOTS) visit(root);
  return files;
}

function sourceKind(path: string): ts.ScriptKind {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function location(path: string, source: ts.SourceFile, node: ts.Node): string {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${relative(REPOSITORY_ROOT, path)}:${line + 1}:${character + 1}`;
}

function staticText(node: ts.Node, source: ts.SourceFile): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(source);
  return null;
}

describe("Library scope architecture", () => {
  it("requires production root Repo construction to include libraryId", () => {
    const violations: string[] = [];

    for (const path of productionSourceFiles()) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        sourceKind(path),
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          LIBRARY_SCOPED_REPOS.has(node.expression.text) &&
          (node.arguments?.length ?? 0) < 2
        ) {
          violations.push(
            `${location(path, source, node)} constructs ${node.expression.text} without libraryId`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("requires production SQL touching Library root tables to declare library_id scope", () => {
    const violations: string[] = [];

    for (const path of productionSourceFiles()) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        sourceKind(path),
      );
      const visit = (node: ts.Node) => {
        const sql = staticText(node, source);
        if (sql && ROOT_TABLE_SQL.test(sql) && !/\blibrary_id\b/i.test(sql)) {
          violations.push(
            `${location(path, source, node)} touches a Library root table without library_id`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
