import type { Migration } from "./migrations.js";
import { applyKnowledgeV20 } from "./migration-knowledge.js";
import { applyKnowledgeContentUnitsFtsV21 } from "./migration-knowledge-fts.js";
import { applyKnowledgeIndexesV22 } from "./migration-knowledge-indexes.js";
import { applyKnowledgeSourceVisibilityV28 } from "./migration-knowledge-source-visibility.js";
import { applyEvidenceShelfV29 } from "./migration-evidence-shelf.js";
import { applyWorkPageIndexesV23 } from "./migration-work-page-indexes.js";

export const knowledgeMigrations: Migration[] = [
  { version: 20, name: "knowledge_jobs", sql: "", apply: applyKnowledgeV20 },
  {
    version: 21,
    name: "knowledge_content_units_fts",
    sql: "",
    apply: applyKnowledgeContentUnitsFtsV21,
  },
  { version: 22, name: "knowledge_index_generations", sql: "", apply: applyKnowledgeIndexesV22 },
  { version: 23, name: "work_page_indexes", sql: "", apply: applyWorkPageIndexesV23 },
];

export const knowledgePostRuntimeMigrations: Migration[] = [
  {
    version: 28,
    name: "knowledge_current_source_visibility",
    sql: "",
    apply: applyKnowledgeSourceVisibilityV28,
  },
  {
    version: 29,
    name: "evidence_shelf_items",
    sql: "",
    apply: applyEvidenceShelfV29,
  },
];
