import { readFileSync, readdirSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface RepoTarget {
  className: string;
  path: string;
}

const legacyRepoTransactionEntrypoints = [
  "CanvasRepo.create",
  "CanvasRepo.deleteNode",
  "CanvasRepo.deleteWorkspace",
  "CanvasRepo.rename",
  "CanvasRepo.save",
  "CollectionsRepo.move",
  "CollectionsRepo.restore",
  "CollectionsRepo.setWorkCollection",
  "CollectionsRepo.setWorksCollection",
  "CollectionsRepo.softDelete",
  "FlashcardsRepo.create",
  "FlashcardsRepo.createMany",
  "FlashcardsRepo.review",
  "SentinelRepo.recordCheck",
  "SentinelRepo.recordCheckWithEvents",
  "TagsRepo.addToWorks",
  "TagsRepo.rename",
  "TagsRepo.restore",
  "TagsRepo.softDelete",
  "WorksRepo.mergeInto",
  "WorksRepo.purgeDeleted",
  "WorksRepo.purgeDeletedMany",
  "WorksRepo.restoreMany",
  "WorksRepo.softDeleteMany",
  "WorksRepo.update",
  "WorksRepo.upsert",
  "WorksRepo.upsertMany",
];

const legacyRepoTransactionFiles = [
  "../../packages/db/src/repos/canvas.ts",
  "../../packages/db/src/repos/collections.ts",
  "../../packages/db/src/repos/flashcards.ts",
  "../../packages/db/src/repos/sentinel.ts",
  "../../packages/db/src/repos/tags.ts",
  "../../packages/db/src/repos/works.ts",
];

const migratedRendererTransactionMethods = [
  "mergeInto",
  "purgeDeleted",
  "purgeDeletedMany",
  "restoreMany",
  "softDeleteMany",
];

describe("legacy repository transaction debt", () => {
  it("keeps the repository transaction entrypoint inventory explicit", () => {
    const actual = repositoryTargets().flatMap(transactionEntrypoints).sort();

    expect(actual).toEqual(legacyRepoTransactionEntrypoints);
  });

  it("does not add transaction-control repository files", () => {
    const files = walkTypeScript(resolve(process.cwd(), "../../packages/db/src/repos"))
      .filter((path) => sourceHasTransactionControl(path))
      .map(portableRelative)
      .sort();

    expect(files).toEqual(legacyRepoTransactionFiles);
  });

  it("does not add renderer-owned transaction-control files", () => {
    const sourceRoot = resolve(process.cwd(), "src");
    const files = walkTypeScript(sourceRoot)
      .filter((path) => sourceHasTransactionControl(path))
      .map(portableRelative)
      .sort();

    // This storage adapter's savepoint is only the non-Electron fallback.
    // Desktop sync applies remote segments through the main-owned runner,
    // whose outer transaction is asserted in sync-runner.test.ts.
    expect(files).toEqual(["src/shared/sqlite-sync-storage.ts"]);
  });

  it("keeps migrated transaction methods unreachable from renderer production code", () => {
    const calls = walkTypeScript(resolve(process.cwd(), "src"))
      .flatMap((path) =>
        referencedPropertyMethods(parseSource(path))
          .filter((method) => migratedRendererTransactionMethods.includes(method))
          .map((method) => `${portableRelative(path)}:${method}`),
      )
      .sort();

    expect(calls).toEqual([]);
  });
});

function repositoryTargets(): RepoTarget[] {
  return walkTypeScript(resolve(process.cwd(), "../../packages/db/src/repos")).flatMap((path) => {
    const sourceFile = parseSource(path);
    return sourceFile.statements.flatMap((statement) =>
      ts.isClassDeclaration(statement) && statement.name
        ? [{ className: statement.name.text, path }]
        : [],
    );
  });
}

function transactionEntrypoints(target: RepoTarget): string[] {
  const sourceFile = parseSource(target.path);
  const repoClass = sourceFile.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === target.className,
  );
  if (!repoClass) throw new Error(`Missing ${target.className} in ${target.path}`);

  const methods = new Map<string, ts.MethodDeclaration>();
  for (const member of repoClass.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const name = memberName(member.name);
    if (name) methods.set(name, member);
  }

  const memo = new Map<string, boolean>();
  const reachesTransaction = (name: string, visiting = new Set<string>()): boolean => {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    if (visiting.has(name)) return false;
    const method = methods.get(name);
    if (!method) return false;
    const nextVisiting = new Set(visiting).add(name);
    const reaches =
      nodeHasTransactionControl(method) ||
      calledThisMethods(method).some((called) => reachesTransaction(called, nextVisiting));
    memo.set(name, reaches);
    return reaches;
  };

  return [...methods.entries()]
    .filter(([, method]) => !hasModifier(method, ts.SyntaxKind.PrivateKeyword))
    .filter(([name]) => reachesTransaction(name))
    .map(([name]) => `${target.className}.${name}`);
}

function calledThisMethods(node: ts.Node): string[] {
  const calls = new Set<string>();
  visit(node, (candidate) => {
    if (
      ts.isCallExpression(candidate) &&
      ts.isPropertyAccessExpression(candidate.expression) &&
      candidate.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      calls.add(candidate.expression.name.text);
    }
  });
  return [...calls];
}

function referencedPropertyMethods(node: ts.Node): string[] {
  const calls = new Set<string>();
  visit(node, (candidate) => {
    if (ts.isPropertyAccessExpression(candidate)) {
      calls.add(candidate.name.text);
    } else if (
      ts.isElementAccessExpression(candidate) &&
      candidate.argumentExpression &&
      ts.isStringLiteralLike(candidate.argumentExpression)
    ) {
      calls.add(candidate.argumentExpression.text);
    }
  });
  return [...calls];
}

function sourceHasTransactionControl(path: string): boolean {
  return nodeHasTransactionControl(parseSource(path));
}

function nodeHasTransactionControl(node: ts.Node): boolean {
  let found = false;
  visit(node, (candidate) => {
    if (found || !ts.isCallExpression(candidate)) return;
    const expression = candidate.expression;
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "exec") return;
    const sql = staticSqlPrefix(candidate.arguments[0]);
    if (sql && /^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql.trimStart())) {
      found = true;
    }
  });
  return found;
}

function staticSqlPrefix(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return null;
}

function memberName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((item) => item.kind === kind))
  );
}

function parseSource(path: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    basename(path),
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const parseDiagnostics =
    (
      sourceFile as ts.SourceFile & {
        parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const detail = parseDiagnostics
      .slice(0, 3)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("; ");
    throw new Error(`Could not parse ${portableRelative(path)}: ${detail}`);
  }
  return sourceFile;
}

function walkTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return walkTypeScript(path);
    if (
      !entry.isFile() ||
      !/\.[cm]?tsx?$/.test(entry.name) ||
      /\.test\.[cm]?tsx?$/.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void): void {
  inspect(node);
  ts.forEachChild(node, (child) => visit(child, inspect));
}

function portableRelative(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
