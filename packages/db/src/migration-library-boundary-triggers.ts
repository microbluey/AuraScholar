import type { SqlExecutor } from "./migrations.js";

export async function createLibraryBoundaryTriggers(db: SqlExecutor): Promise<void> {
  await db.exec(`
    CREATE TRIGGER works_library_immutable
    BEFORE UPDATE OF library_id ON works
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'work library ownership is immutable');
    END;
    CREATE TRIGGER authors_library_immutable
    BEFORE UPDATE OF library_id ON authors
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'author library ownership is immutable');
    END;
    CREATE TRIGGER collections_library_immutable
    BEFORE UPDATE OF library_id ON collections
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'collection library ownership is immutable');
    END;
    CREATE TRIGGER tags_library_immutable
    BEFORE UPDATE OF library_id ON tags
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'tag library ownership is immutable');
    END;
    CREATE TRIGGER saved_searches_library_immutable
    BEFORE UPDATE OF library_id ON saved_searches
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'saved search library ownership is immutable');
    END;
    CREATE TRIGGER canvas_workspaces_library_immutable
    BEFORE UPDATE OF library_id ON canvas_workspaces
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'canvas workspace library ownership is immutable');
    END;
    CREATE TRIGGER sentinel_tasks_library_immutable
    BEFORE UPDATE OF library_id ON sentinel_tasks
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'sentinel task library ownership is immutable');
    END;
    CREATE TRIGGER ai_jobs_library_immutable
    BEFORE UPDATE OF library_id ON ai_jobs
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'AI job library ownership is immutable');
    END;
    CREATE TRIGGER derived_artifacts_library_immutable
    BEFORE UPDATE OF library_id ON derived_artifacts
    WHEN OLD.library_id <> NEW.library_id
    BEGIN
      SELECT RAISE(ABORT, 'derived artifact library ownership is immutable');
    END;
    CREATE TRIGGER derived_artifacts_work_source_insert
    BEFORE INSERT ON derived_artifacts
    WHEN NEW.source_table = 'works' AND NOT EXISTS (
      SELECT 1 FROM works w
      WHERE w.id = NEW.source_id AND w.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'derived artifact work must stay within its library');
    END;
    CREATE TRIGGER derived_artifacts_work_source_update
    BEFORE UPDATE OF library_id, source_table, source_id ON derived_artifacts
    WHEN NEW.source_table = 'works' AND NOT EXISTS (
      SELECT 1 FROM works w
      WHERE w.id = NEW.source_id AND w.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'derived artifact work must stay within its library');
    END;

    CREATE TRIGGER work_authors_library_insert
    BEFORE INSERT ON work_authors
    WHEN NOT EXISTS (
      SELECT 1 FROM works w
      JOIN authors a ON a.id = NEW.author_id
      WHERE w.id = NEW.work_id AND w.library_id = a.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'work_authors must stay within one library');
    END;
    CREATE TRIGGER work_authors_library_update
    BEFORE UPDATE OF work_id, author_id ON work_authors
    WHEN NOT EXISTS (
      SELECT 1 FROM works w
      JOIN authors a ON a.id = NEW.author_id
      WHERE w.id = NEW.work_id AND w.library_id = a.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'work_authors must stay within one library');
    END;

    CREATE TRIGGER collection_items_library_insert
    BEFORE INSERT ON collection_items
    WHEN NOT EXISTS (
      SELECT 1 FROM collections c
      JOIN works w ON w.id = NEW.work_id
      WHERE c.id = NEW.collection_id AND c.library_id = w.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'collection_items must stay within one library');
    END;
    CREATE TRIGGER collection_items_library_update
    BEFORE UPDATE OF collection_id, work_id ON collection_items
    WHEN NOT EXISTS (
      SELECT 1 FROM collections c
      JOIN works w ON w.id = NEW.work_id
      WHERE c.id = NEW.collection_id AND c.library_id = w.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'collection_items must stay within one library');
    END;

    CREATE TRIGGER work_tags_library_insert
    BEFORE INSERT ON work_tags
    WHEN NOT EXISTS (
      SELECT 1 FROM works w
      JOIN tags t ON t.id = NEW.tag_id
      WHERE w.id = NEW.work_id AND w.library_id = t.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'work_tags must stay within one library');
    END;
    CREATE TRIGGER work_tags_library_update
    BEFORE UPDATE OF work_id, tag_id ON work_tags
    WHEN NOT EXISTS (
      SELECT 1 FROM works w
      JOIN tags t ON t.id = NEW.tag_id
      WHERE w.id = NEW.work_id AND w.library_id = t.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'work_tags must stay within one library');
    END;

    CREATE TRIGGER citations_library_insert
    BEFORE INSERT ON citations
    WHEN NOT EXISTS (
      SELECT 1 FROM works citing
      JOIN works cited ON cited.id = NEW.cited_work_id
      WHERE citing.id = NEW.citing_work_id
        AND citing.library_id = cited.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'citations must stay within one library');
    END;
    CREATE TRIGGER citations_library_update
    BEFORE UPDATE OF citing_work_id, cited_work_id ON citations
    WHEN NOT EXISTS (
      SELECT 1 FROM works citing
      JOIN works cited ON cited.id = NEW.cited_work_id
      WHERE citing.id = NEW.citing_work_id
        AND citing.library_id = cited.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'citations must stay within one library');
    END;

    CREATE TRIGGER collections_parent_library_insert
    BEFORE INSERT ON collections
    WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM collections parent
      WHERE parent.id = NEW.parent_id
        AND parent.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'collection parent must stay within one library');
    END;
    CREATE TRIGGER collections_parent_library_update
    BEFORE UPDATE OF parent_id, library_id ON collections
    WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM collections parent
      WHERE parent.id = NEW.parent_id
        AND parent.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'collection parent must stay within one library');
    END;

    CREATE TRIGGER annotations_work_insert
    BEFORE INSERT ON annotations
    WHEN NOT EXISTS (
      SELECT 1 FROM attachments a
      WHERE a.id = NEW.attachment_id AND a.work_id = NEW.work_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'annotation attachment must belong to its work');
    END;
    CREATE TRIGGER annotations_work_update
    BEFORE UPDATE OF attachment_id, work_id ON annotations
    WHEN NOT EXISTS (
      SELECT 1 FROM attachments a
      WHERE a.id = NEW.attachment_id AND a.work_id = NEW.work_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'annotation attachment must belong to its work');
    END;

    CREATE TRIGGER canvas_nodes_library_insert
    BEFORE INSERT ON canvas_nodes
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM canvas_workspaces cw
      JOIN works w ON w.id = NEW.work_id
      WHERE cw.id = NEW.workspace_id AND cw.library_id = w.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas node work must stay within its library');
    END;
    CREATE TRIGGER canvas_nodes_library_update
    BEFORE UPDATE OF workspace_id, work_id ON canvas_nodes
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM canvas_workspaces cw
      JOIN works w ON w.id = NEW.work_id
      WHERE cw.id = NEW.workspace_id AND cw.library_id = w.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas node work must stay within its library');
    END;

    CREATE TRIGGER canvas_edges_workspace_insert
    BEFORE INSERT ON canvas_edges
    WHEN NOT EXISTS (
      SELECT 1 FROM canvas_nodes source
      JOIN canvas_nodes target ON target.id = NEW.target_id
      WHERE source.id = NEW.source_id
        AND source.workspace_id = NEW.workspace_id
        AND target.workspace_id = NEW.workspace_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas edge nodes must belong to its workspace');
    END;
    CREATE TRIGGER canvas_edges_workspace_update
    BEFORE UPDATE OF workspace_id, source_id, target_id ON canvas_edges
    WHEN NOT EXISTS (
      SELECT 1 FROM canvas_nodes source
      JOIN canvas_nodes target ON target.id = NEW.target_id
      WHERE source.id = NEW.source_id
        AND source.workspace_id = NEW.workspace_id
        AND target.workspace_id = NEW.workspace_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'canvas edge nodes must belong to its workspace');
    END;

    CREATE TRIGGER sentinel_tasks_library_insert
    BEFORE INSERT ON sentinel_tasks
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM works w
      WHERE w.id = NEW.work_id AND w.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'sentinel task work must stay within its library');
    END;
    CREATE TRIGGER sentinel_tasks_library_update
    BEFORE UPDATE OF library_id, work_id ON sentinel_tasks
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM works w
      WHERE w.id = NEW.work_id AND w.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'sentinel task work must stay within its library');
    END;

    CREATE TRIGGER ai_jobs_library_insert
    BEFORE INSERT ON ai_jobs
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM works w
      WHERE w.id = NEW.work_id AND w.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'AI job work must stay within its library');
    END;
    CREATE TRIGGER ai_jobs_library_update
    BEFORE UPDATE OF library_id, work_id ON ai_jobs
    WHEN NEW.work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM works w
      WHERE w.id = NEW.work_id AND w.library_id = NEW.library_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'AI job work must stay within its library');
    END;
  `);
}
