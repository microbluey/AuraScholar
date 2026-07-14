// Workspace-wide ESLint flat config. Deliberately non-type-aware (fast, no
// per-package tsconfig plumbing); typecheck already runs as its own CI step.
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/release/**",
      "**/.turbo/**",
      ".pnpm-store/**",
      "design-qa-artifacts/**",
      "**/*.config.{js,ts,mjs}",
      "apps/desktop/scripts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase legitimately passes `unknown`/dynamic data around at the
      // platform and IPC boundaries; `any` is still banned, but unused vars
      // prefixed with _ are fine.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `while (true)` polling loops are idiomatic in the sentinel/sync code.
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["**/*.tsx", "packages/reader/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Compiler-era diagnostics: real signal but fixing them means reworking
      // data-loading effects across the big pages. Keep visible as warnings;
      // burn down alongside the LibraryPage/DiscoveryPage decomposition.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    // The smoke harness builds giant renderer-eval strings; lint noise there
    // has no payoff.
    files: ["apps/desktop/electron/main/smoke.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
