import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { libraries, works } from "./library-schema.js";

const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
const deletedAt = () => integer("deleted_at");

export const researchProjects = sqliteTable(
  "research_projects",
  {
    id: text("id").primaryKey(),
    libraryId: text("library_id")
      .notNull()
      .references(() => libraries.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index("research_projects_library_status_idx").on(
      table.libraryId,
      table.deletedAt,
      table.status,
      table.updatedAt,
    ),
    check("research_projects_name_check", sql`length(trim(${table.name})) > 0`),
    check("research_projects_status_check", sql`${table.status} IN ('active', 'archived')`),
  ],
);

export const projectWorks = sqliteTable(
  "project_works",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "cascade" }),
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("source"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex("project_works_project_work_uq").on(table.projectId, table.workId),
    index("project_works_project_active_idx").on(table.projectId, table.deletedAt, table.updatedAt),
    index("project_works_project_active_created_work_idx").on(
      table.projectId,
      table.deletedAt,
      table.createdAt,
      table.workId,
    ),
    index("project_works_work_active_idx").on(table.workId, table.deletedAt),
    check("project_works_role_check", sql`length(trim(${table.role})) > 0`),
  ],
);
