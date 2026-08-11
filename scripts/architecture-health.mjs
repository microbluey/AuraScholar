import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const BASELINE_FILE = "architecture-health-baseline.json";
const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "dist", "node_modules", "out", "release"]);
const UI_GATEWAY_ALLOWLIST = new Set([
  "apps/desktop/src/shared/library-backup.ts",
  "apps/desktop/src/shared/sqlite-sync-storage.ts",
]);

export function normalizePath(value) {
  return value.split(sep).join("/");
}

export function countPhysicalLines(text) {
  if (!text) return 0;
  const newlines = text.match(/\n/g)?.length ?? 0;
  return newlines + (text.endsWith("\n") ? 0 : 1);
}

export function classifySourcePath(path) {
  const normalized = normalizePath(path);
  const extension = extname(normalized);
  if (!SOURCE_EXTENSIONS.has(extension)) return null;
  if (normalized.endsWith(".d.ts") || /(^|\/)(generated|vendor)(\/|\.|$)/.test(normalized)) {
    return null;
  }
  const inSource =
    /^apps\/[^/]+\/src\//.test(normalized) ||
    /^packages\/[^/]+\/src\//.test(normalized) ||
    normalized.startsWith("apps/desktop/electron/");
  if (!inSource) return null;
  const electronSmoke =
    normalized === "apps/desktop/electron/main/smoke.ts" ||
    normalized.startsWith("apps/desktop/electron/main/smoke/");
  const test = /\.(?:test|spec)\.[^.]+$/.test(normalized) || electronSmoke;
  return { category: test ? "tests" : "production", extension };
}

export function fileLimit(path, category) {
  if (category === "tests") return 800;
  return extname(path) === ".tsx" ? 400 : 500;
}

function addFingerprint(target, rule, path, subject, amount = 1) {
  const key = `${rule}|${path}|${subject}`;
  target[key] = (target[key] ?? 0) + amount;
}

function isUiBoundaryPath(path) {
  if (!path.startsWith("apps/desktop/src/")) return false;
  const extension = extname(path);
  if (extension !== ".ts" && extension !== ".tsx") return false;
  if (
    path.endsWith(".d.ts") ||
    /(^|\/)(generated|vendor)(\/|\.|$)/.test(path) ||
    /\.(?:test|spec)\.[^.]+$/.test(path) ||
    path.startsWith("apps/desktop/src/services/") ||
    UI_GATEWAY_ALLOWLIST.has(path)
  ) {
    return false;
  }
  return true;
}

function isRendererDbGatewayModule(moduleName) {
  return /(?:^|\/)services\/aura-db(?:\.[cm]?[jt]s)?$/.test(moduleName);
}

function importClauseHasRuntimeValue(clause) {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) return false;
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return true;
  const specifiers = trimmed
    .slice(1, -1)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return specifiers.some((specifier) => !specifier.startsWith("type "));
}

function runtimeBarrelRepoNames(clause) {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ")) return [];
  if (trimmed.includes("* as ")) return ["namespace"];
  const names = [];
  const named = trimmed.match(/\{([\s\S]*)\}/)?.[1] ?? "";
  for (const specifier of named
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    if (specifier.startsWith("type ")) continue;
    const importedName = specifier.split(/\s+as\s+/)[0]?.trim() ?? "";
    if (importedName.endsWith("Repo")) names.push(importedName);
  }
  const defaultImport = trimmed.split(",")[0]?.trim() ?? "";
  if (!trimmed.startsWith("{") && defaultImport.endsWith("Repo")) names.push(defaultImport);
  return names;
}

export function collectBoundaryFingerprints(path, text) {
  const normalized = normalizePath(path);
  const fingerprints = {};
  if (!isUiBoundaryPath(normalized)) return fingerprints;

  const staticImports = /^\s*import\s+(?!\()([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;
  for (const match of text.matchAll(staticImports)) {
    const [, clause = "", moduleName = ""] = match;
    if (!importClauseHasRuntimeValue(clause)) continue;
    if (moduleName.startsWith("@aurascholar/db/repos/")) {
      addFingerprint(fingerprints, "runtime-repo-import", normalized, moduleName);
    }
    if (moduleName === "@aurascholar/db") {
      for (const repoName of runtimeBarrelRepoNames(clause)) {
        addFingerprint(
          fingerprints,
          "runtime-repo-import",
          normalized,
          `${moduleName}:${repoName}`,
        );
      }
    }
    if (isRendererDbGatewayModule(moduleName)) {
      addFingerprint(fingerprints, "runtime-db-gateway-import", normalized, moduleName);
    }
  }

  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!isRendererDbGatewayModule(match[1])) continue;
    addFingerprint(fingerprints, "dynamic-db-gateway-import", normalized, match[1]);
  }
  for (const match of text.matchAll(
    /\bimport\s*\(\s*["'](@aurascholar\/db\/repos\/[^"']+)["']\s*\)/g,
  )) {
    addFingerprint(fingerprints, "dynamic-repo-import", normalized, match[1]);
  }
  for (const match of text.matchAll(
    /\bnew\s+(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*Repo)\s*\(/g,
  )) {
    addFingerprint(fingerprints, "repo-construction", normalized, match[1]);
  }
  for (const _match of text.matchAll(/\bgetLibraryDb\s*\(/g)) {
    addFingerprint(fingerprints, "get-library-db", normalized, "call");
  }
  for (const match of text.matchAll(/\bwindow\.aura\.db\.([A-Za-z_$][\w$]*)/g)) {
    addFingerprint(fingerprints, "renderer-db-bridge", normalized, match[1]);
  }
  for (const match of text.matchAll(
    /\b(?:db|database)\s*\.\s*(query|queryScalar|run|exec|prepare)\s*(?:<[\s\S]{0,4000}?>\s*)?\(/g,
  )) {
    addFingerprint(fingerprints, "direct-sql-method", normalized, match[1]);
  }
  for (const _match of text.matchAll(/\bcitationCountsForWorks\s*\(\s*(?:db|database)\b/g)) {
    addFingerprint(fingerprints, "direct-data-helper", normalized, "citationCountsForWorks");
  }
  return fingerprints;
}

function listTrackedFiles(repoRoot) {
  const files = [];
  for (const rootName of ["apps", "packages"]) {
    const root = resolve(repoRoot, rootName);
    if (!existsSync(root)) continue;
    const visit = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const absolute = resolve(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) files.push(normalizePath(relative(repoRoot, absolute)));
      }
    };
    visit(root);
  }
  return files.sort();
}

function emptySourceBucket() {
  return { byExtension: {}, files: {}, totalLines: 0 };
}

export function collectSourceSnapshot(repoRoot) {
  const source = { production: emptySourceBucket(), tests: emptySourceBucket() };
  const uiDatabaseBoundary = {};
  for (const path of listTrackedFiles(repoRoot)) {
    const classification = classifySourcePath(path);
    if (!classification) continue;
    const text = readFileSync(resolve(repoRoot, path), "utf8");
    const lines = countPhysicalLines(text);
    const bucket = source[classification.category];
    bucket.files[path] = lines;
    bucket.totalLines += lines;
    bucket.byExtension[classification.extension] =
      (bucket.byExtension[classification.extension] ?? 0) + lines;
    Object.assign(
      uiDatabaseBoundary,
      mergeCounts(uiDatabaseBoundary, collectBoundaryFingerprints(path, text)),
    );
  }
  return { source, uiDatabaseBoundary };
}

function mergeCounts(left, right) {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) result[key] = (result[key] ?? 0) + value;
  return result;
}

function eslintBinary(repoRoot) {
  const suffix = process.platform === "win32" ? "eslint.cmd" : "eslint";
  const local = resolve(repoRoot, "node_modules", ".bin", suffix);
  return existsSync(local) ? local : suffix;
}

export function collectLintWarnings(repoRoot, eslintConfigPath = null) {
  const args = [".", "--format", "json"];
  if (eslintConfigPath) args.push("--config", eslintConfigPath);
  const result = spawnSync(eslintBinary(repoRoot), args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let reports;
  try {
    reports = JSON.parse(result.stdout || "[]");
  } catch {
    throw new Error(`ESLint did not return JSON: ${result.stderr || result.stdout}`);
  }
  const errors = reports.flatMap((report) =>
    report.messages.filter((message) => message.severity === 2),
  );
  if (errors.length > 0) throw new Error(`ESLint reported ${errors.length} error(s)`);
  if (result.status !== 0) {
    throw new Error(`ESLint exited with status ${result.status}: ${result.stderr}`);
  }
  const warnings = {};
  for (const report of reports) {
    const path = normalizePath(relative(repoRoot, report.filePath));
    for (const message of report.messages) {
      if (message.severity !== 1) continue;
      addFingerprint(warnings, "lint-warning", path, message.ruleId ?? "unknown");
    }
  }
  return warnings;
}

export function createSnapshot(repoRoot, options = {}) {
  const { source, uiDatabaseBoundary } = collectSourceSnapshot(repoRoot);
  return sortDeep({
    schemaVersion: SCHEMA_VERSION,
    source,
    uiDatabaseBoundary,
    lintWarnings: options.skipLint
      ? {}
      : collectLintWarnings(repoRoot, options.eslintConfigPath ?? null),
  });
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortDeep(value[key])]),
  );
}

export function stableSnapshotJson(snapshot) {
  return `${JSON.stringify(sortDeep(snapshot), null, 2)}\n`;
}

function compareFingerprintBudget(current, base, label) {
  const failures = [];
  for (const [fingerprint, count] of Object.entries(current)) {
    const allowed = base[fingerprint] ?? 0;
    if (count > allowed) failures.push(`${label}: ${fingerprint} is ${count}, allowed ${allowed}`);
  }
  return failures;
}

export function compareRatchet(current, base) {
  const failures = [];
  for (const category of ["production", "tests"]) {
    for (const [path, lines] of Object.entries(current.source[category].files)) {
      const limit = fileLimit(path, category);
      const baseLines = base.source[category].files[path];
      const allowed = baseLines === undefined ? limit : Math.max(limit, baseLines);
      if (lines > allowed) {
        failures.push(`${category} size: ${path} is ${lines} lines, allowed ${allowed}`);
      }
    }
  }
  failures.push(
    ...compareFingerprintBudget(
      current.uiDatabaseBoundary,
      base.uiDatabaseBoundary,
      "UI database boundary",
    ),
    ...compareFingerprintBudget(current.lintWarnings, base.lintWarnings, "Lint warning"),
  );
  return failures;
}

function gitShow(repoRoot, ref, path) {
  const result = spawnSync("git", ["show", `${ref}:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

function createSnapshotWithPolicy(repoRoot, base) {
  if (!base) return createSnapshot(repoRoot);
  const eslintConfig = gitShow(repoRoot, base, "eslint.config.mjs");
  if (!eslintConfig) throw new Error(`Cannot read eslint.config.mjs from ${base}`);
  const temporaryConfig = resolve(
    repoRoot,
    `.architecture-health-eslint-${process.pid}.config.mjs`,
  );
  writeFileSync(temporaryConfig, eslintConfig);
  try {
    return createSnapshot(repoRoot, { eslintConfigPath: temporaryConfig });
  } finally {
    unlinkSync(temporaryConfig);
  }
}

function readBaseline(path) {
  if (!existsSync(path)) throw new Error(`Missing ${BASELINE_FILE}; run pnpm health:baseline`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function printReport(snapshot) {
  const { production, tests } = snapshot.source;
  const warnings = Object.values(snapshot.lintWarnings).reduce((sum, count) => sum + count, 0);
  const boundaries = Object.values(snapshot.uiDatabaseBoundary).reduce(
    (sum, count) => sum + count,
    0,
  );
  console.log(
    `Architecture health: ${production.totalLines} production lines, ` +
      `${tests.totalLines} test lines, ${warnings} lint warnings, ` +
      `${boundaries} UI database boundary debts.`,
  );
  const largest = [...Object.entries(production.files), ...Object.entries(tests.files)]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12);
  for (const [path, lines] of largest) console.log(`${String(lines).padStart(6)}  ${path}`);
}

function parseArgs(argv) {
  const options = { command: argv[0] ?? "report", repoRoot: process.cwd(), base: null };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--repo") options.repoRoot = resolve(argv[++index]);
    else if (argv[index] === "--base") options.base = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function emitFailures(failures) {
  for (const failure of failures) {
    console.error(failure);
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::error title=Architecture health regression::${failure}`);
    }
  }
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const baselinePath = resolve(options.repoRoot, BASELINE_FILE);
  const snapshot = createSnapshotWithPolicy(options.repoRoot, options.base);
  if (options.command === "report") {
    printReport(snapshot);
    return 0;
  }
  if (options.command === "baseline") {
    writeFileSync(baselinePath, stableSnapshotJson(snapshot));
    printReport(snapshot);
    console.log(`Updated ${BASELINE_FILE}.`);
    return 0;
  }
  if (options.command !== "check") throw new Error(`Unknown command: ${options.command}`);

  const baseline = readBaseline(baselinePath);
  const failures = [];
  if (stableSnapshotJson(snapshot) !== stableSnapshotJson(baseline)) {
    failures.push(`Current metrics do not match ${BASELINE_FILE}; run pnpm health:baseline`);
  }
  if (options.base) {
    const rawBase = gitShow(options.repoRoot, options.base, BASELINE_FILE);
    if (rawBase) failures.push(...compareRatchet(snapshot, JSON.parse(rawBase)));
    else console.log(`Bootstrap check: ${options.base} has no architecture health baseline.`);
  }
  if (failures.length > 0) {
    emitFailures(failures);
    return 1;
  }
  printReport(snapshot);
  console.log("Architecture health ratchet passed.");
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
