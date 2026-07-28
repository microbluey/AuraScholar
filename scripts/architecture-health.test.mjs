import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifySourcePath,
  collectBoundaryFingerprints,
  compareRatchet,
  countPhysicalLines,
  runCli,
  stableSnapshotJson,
} from "./architecture-health.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function snapshot({ production = {}, tests = {}, boundaries = {}, warnings = {} } = {}) {
  return {
    schemaVersion: 1,
    source: {
      production: { byExtension: {}, files: production, totalLines: 0 },
      tests: { byExtension: {}, files: tests, totalLines: 0 },
    },
    uiDatabaseBoundary: boundaries,
    lintWarnings: warnings,
  };
}

test("counts LF, CRLF, and missing trailing newline consistently", () => {
  assert.equal(countPhysicalLines(""), 0);
  assert.equal(countPhysicalLines("one\n"), 1);
  assert.equal(countPhysicalLines("one\ntwo"), 2);
  assert.equal(countPhysicalLines("one\r\ntwo\r\n"), 2);
});

test("classifies production, test, smoke, and generated sources", () => {
  assert.deepEqual(classifySourcePath("apps/desktop/src/pages/LibraryPage.tsx"), {
    category: "production",
    extension: ".tsx",
  });
  assert.deepEqual(classifySourcePath("packages/db/src/repos/repos.test.ts"), {
    category: "tests",
    extension: ".ts",
  });
  assert.deepEqual(classifySourcePath("apps/desktop/electron/main/smoke.ts"), {
    category: "tests",
    extension: ".ts",
  });
  assert.equal(classifySourcePath("packages/tokens/src/generated.ts"), null);
  assert.equal(classifySourcePath("apps/desktop/out/main.js"), null);
});

test("distinguishes type-only imports from renderer database access", () => {
  const path = "apps/desktop/src/pages/ProbePage.tsx";
  const result = collectBoundaryFingerprints(
    path,
    `
      import type { WorkWithAuthors } from "@aurascholar/db/repos/works";
      import { type AnnotationRow } from "@aurascholar/db/repos/annotations";
      import { WorksRepo, type ReadingStatus } from "@aurascholar/db/repos/works";
      import { TagsRepo } from "@aurascholar/db";
      import { type CollectionsRepo, newId } from "@aurascholar/db";
      import { getLibraryDb } from "../services/aura-db";

      async function mutate() {
        const { TagsRepo } = await import("@aurascholar/db/repos/tags");
        const { db } = await getLibraryDb();
        await new WorksRepo(db, "library").setStarred("work", true);
        await new data.WorksRepo(db, "library").setStarred("work", true);
        await db.query("SELECT id FROM works");
        /probe/.exec("probe");
        return new TagsRepo(db, "library");
      }
    `,
  );

  assert.equal(
    result["runtime-repo-import|apps/desktop/src/pages/ProbePage.tsx|@aurascholar/db/repos/works"],
    1,
  );
  assert.equal(
    result["dynamic-repo-import|apps/desktop/src/pages/ProbePage.tsx|@aurascholar/db/repos/tags"],
    1,
  );
  assert.equal(
    result["runtime-repo-import|apps/desktop/src/pages/ProbePage.tsx|@aurascholar/db:TagsRepo"],
    1,
  );
  assert.equal(
    result[
      "runtime-repo-import|apps/desktop/src/pages/ProbePage.tsx|@aurascholar/db:CollectionsRepo"
    ],
    undefined,
  );
  assert.equal(result["repo-construction|apps/desktop/src/pages/ProbePage.tsx|WorksRepo"], 2);
  assert.equal(result["get-library-db|apps/desktop/src/pages/ProbePage.tsx|call"], 1);
  assert.equal(result["direct-sql-method|apps/desktop/src/pages/ProbePage.tsx|query"], 1);
  assert.equal(result["direct-sql-method|apps/desktop/src/pages/ProbePage.tsx|exec"], undefined);
  assert.equal(
    result[
      "runtime-repo-import|apps/desktop/src/pages/ProbePage.tsx|@aurascholar/db/repos/annotations"
    ],
    undefined,
  );
});

test("freezes oversized files while allowing compliant files to grow", () => {
  const base = snapshot({
    production: {
      "apps/desktop/src/pages/GiantPage.tsx": 900,
      "apps/desktop/src/pages/SmallPage.tsx": 200,
    },
  });
  assert.deepEqual(
    compareRatchet(
      snapshot({
        production: {
          "apps/desktop/src/pages/GiantPage.tsx": 900,
          "apps/desktop/src/pages/SmallPage.tsx": 400,
        },
      }),
      base,
    ),
    [],
  );
  assert.match(
    compareRatchet(
      snapshot({
        production: {
          "apps/desktop/src/pages/GiantPage.tsx": 901,
          "apps/desktop/src/pages/SmallPage.tsx": 200,
        },
      }),
      base,
    )[0],
    /GiantPage\.tsx is 901 lines, allowed 900/,
  );
  assert.match(
    compareRatchet(
      snapshot({ production: { "apps/desktop/src/pages/NewPage.tsx": 401 } }),
      base,
    )[0],
    /NewPage\.tsx is 401 lines, allowed 400/,
  );
});

test("rejects new warning and boundary fingerprints but accepts debt reduction", () => {
  const base = snapshot({
    boundaries: { "get-library-db|apps/desktop/src/pages/ReaderPage.tsx|call": 2 },
    warnings: {
      "lint-warning|apps/desktop/src/pages/ReaderPage.tsx|react-hooks/set-state-in-effect": 3,
    },
  });
  assert.deepEqual(
    compareRatchet(
      snapshot({
        boundaries: { "get-library-db|apps/desktop/src/pages/ReaderPage.tsx|call": 1 },
        warnings: {
          "lint-warning|apps/desktop/src/pages/ReaderPage.tsx|react-hooks/set-state-in-effect": 2,
        },
      }),
      base,
    ),
    [],
  );
  const failures = compareRatchet(
    snapshot({
      boundaries: {
        "get-library-db|apps/desktop/src/pages/ReaderPage.tsx|call": 2,
        "repo-construction|apps/desktop/src/pages/ReaderPage.tsx|WorksRepo": 1,
      },
      warnings: {
        "lint-warning|apps/desktop/src/pages/ReaderPage.tsx|react-hooks/set-state-in-effect": 4,
      },
    }),
    base,
  );
  assert.equal(failures.length, 2);
  assert.ok(failures.some((failure) => failure.startsWith("UI database boundary:")));
  assert.ok(failures.some((failure) => failure.startsWith("Lint warning:")));
});

test("serializes snapshots deterministically", () => {
  assert.equal(
    stableSnapshotJson({ z: 1, a: { z: 2, a: 1 } }),
    '{\n  "a": {\n    "a": 1,\n    "z": 2\n  },\n  "z": 1\n}\n',
  );
});

test(
  "checks with the committed Git policy and cleans up its temporary ESLint config",
  { timeout: 30_000 },
  () => {
    const temporaryConfigs = () =>
      readdirSync(repoRoot).filter(
        (name) => name.startsWith(".architecture-health-eslint-") && name.endsWith(".config.mjs"),
      );
    assert.deepEqual(temporaryConfigs(), []);
    assert.equal(runCli(["check", "--repo", repoRoot, "--base", "HEAD"]), 0);
    assert.deepEqual(temporaryConfigs(), []);
  },
);
