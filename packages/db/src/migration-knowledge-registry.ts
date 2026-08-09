import type { Migration } from "./migrations.js";
import { applyKnowledgeV20 } from "./migration-knowledge.js";
import { applyKnowledgeContentUnitsFtsV21 } from "./migration-knowledge-fts.js";
import { applyKnowledgeIndexesV22 } from "./migration-knowledge-indexes.js";

export const knowledgeMigrations: Migration[] = [
  { version: 20, name: "knowledge_jobs", sql: "", apply: applyKnowledgeV20 },
  {
    version: 21,
    name: "knowledge_content_units_fts",
    sql: "",
    apply: applyKnowledgeContentUnitsFtsV21,
  },
  { version: 22, name: "knowledge_index_generations", sql: "", apply: applyKnowledgeIndexesV22 },
];
