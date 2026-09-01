import type { Migration } from "./migrations.js";
import {
  knowledgeMigrations,
  knowledgePostRuntimeMigrations,
} from "./migration-knowledge-registry.js";
import { libraryMaintenanceMigrations } from "./migration-library-maintenance.js";
import { runtimeCacheMigrations } from "./migration-runtime-cache.js";

/** Ordered migrations kept outside the runner's core implementation. */
export const postCoreMigrations: Migration[] = [
  ...knowledgeMigrations,
  ...libraryMaintenanceMigrations,
  ...runtimeCacheMigrations,
  ...knowledgePostRuntimeMigrations,
];
