/**
 * Builds the canonical-state predicate shared by every Knowledge read path.
 *
 * ContentUnits are intentionally disposable and can outlive the source row
 * while an asynchronous removal job is running.  Checking only
 * `content_units.deleted_at` therefore leaves a window where a deleted Work,
 * Asset, or Evidence item can still be returned.  The predicate below keeps
 * that window fail-closed without physically deleting derived units.
 *
 * Detached units and legacy PDFs created before Asset/Revision linkage are
 * retained for one compatibility cycle.  There is no revision relationship to
 * validate for those rows, but a claimed Work still has to be active and owned
 * by the same Library.  As soon as a unit claims an Asset or Revision, every
 * claimed parent and source identity must validate.
 */
export interface ContentUnitVisibilityOptions {
  /** SQL identifier used for the ContentUnit row (trusted, not user input). */
  alias?: string;
  /**
   * Permit an explicitly requested, still-live historical PDF revision. This
   * is for exact-source/diagnostic reads only; default search and generation
   * paths leave it disabled so only the Asset's current revision is eligible.
   */
  includeHistoricalPdf?: boolean;
}

/**
 * Returns a parameter-free SQL expression.  Callers should append it to a
 * WHERE clause, or use it inside a trigger's validation SELECT.
 */
export function contentUnitCanonicalVisibilitySql(
  options: ContentUnitVisibilityOptions = {},
): string {
  const alias = options.alias ?? "unit";
  assertSqlAlias(alias);

  const detached = `(${alias}.work_id IS NULL AND ${alias}.asset_id IS NULL AND ${alias}.revision_id IS NULL)`;
  const unrevisionedPdf = `(${alias}.asset_id IS NULL AND ${alias}.revision_id IS NULL)`;
  const activeWork = `(
    ${alias}.work_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM works visibility_work
      WHERE visibility_work.id = ${alias}.work_id
        AND visibility_work.library_id = ${alias}.library_id
        AND visibility_work.deleted_at IS NULL
    )
  )`;
  const activeAsset = `(
    ${alias}.asset_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM document_assets visibility_asset
      WHERE visibility_asset.id = ${alias}.asset_id
        AND visibility_asset.library_id = ${alias}.library_id
        AND visibility_asset.deleted_at IS NULL
        AND visibility_asset.work_id IS ${alias}.work_id
    )
  )`;
  const activeRevision = `(
    ${alias}.revision_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM document_revisions visibility_revision
      JOIN document_assets visibility_revision_asset
        ON visibility_revision_asset.id = visibility_revision.asset_id
      WHERE visibility_revision.id = ${alias}.revision_id
        AND visibility_revision.asset_id IS ${alias}.asset_id
        AND visibility_revision.deleted_at IS NULL
        AND visibility_revision_asset.library_id = ${alias}.library_id
        AND visibility_revision_asset.deleted_at IS NULL
        AND visibility_revision_asset.work_id IS ${alias}.work_id
    )
  )`;

  // PDF text is the source-document retrieval surface: only the revision
  // currently selected by its logical Asset is eligible.  Annotation and
  // Evidence units remain revision-bound, but historical provenance is still
  // useful there and is deliberately not redirected or hidden by this branch.
  const currentRevisionClause = options.includeHistoricalPdf
    ? ""
    : "AND visibility_pdf_asset.current_revision_id = visibility_pdf_revision.id";
  const pdfSource = `(
    ${alias}.source_type <> 'pdf'
    OR ${unrevisionedPdf}
    OR (
      ${alias}.source_id = ${alias}.revision_id
      AND ${alias}.revision_id IS NOT NULL
      AND ${alias}.asset_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM document_revisions visibility_pdf_revision
        JOIN document_assets visibility_pdf_asset
          ON visibility_pdf_asset.id = visibility_pdf_revision.asset_id
        WHERE visibility_pdf_revision.id = ${alias}.revision_id
          AND visibility_pdf_revision.asset_id = ${alias}.asset_id
          AND visibility_pdf_revision.deleted_at IS NULL
          AND visibility_pdf_asset.library_id = ${alias}.library_id
          AND visibility_pdf_asset.deleted_at IS NULL
          ${currentRevisionClause}
          AND visibility_pdf_asset.work_id IS ${alias}.work_id
      )
    )
  )`;

  const annotationSource = `(
    ${alias}.source_type <> 'annotation'
    OR ${detached}
    OR EXISTS (
      SELECT 1
      FROM annotations visibility_annotation
      JOIN attachments visibility_attachment
        ON visibility_attachment.id = visibility_annotation.attachment_id
      WHERE visibility_annotation.id = ${alias}.source_id
        AND visibility_annotation.deleted_at IS NULL
        AND visibility_annotation.work_id IS ${alias}.work_id
        AND visibility_attachment.work_id IS visibility_annotation.work_id
        AND visibility_attachment.deleted_at IS NULL
        AND (
          ${alias}.asset_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM document_revisions visibility_annotation_revision
            WHERE visibility_annotation_revision.asset_id = ${alias}.asset_id
              AND visibility_annotation_revision.attachment_id = visibility_attachment.id
              AND visibility_annotation_revision.deleted_at IS NULL
          )
        )
        AND (
          ${alias}.revision_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM document_revisions visibility_annotation_revision
            WHERE visibility_annotation_revision.id = ${alias}.revision_id
              AND visibility_annotation_revision.asset_id IS ${alias}.asset_id
              AND visibility_annotation_revision.attachment_id = visibility_attachment.id
              AND visibility_annotation_revision.deleted_at IS NULL
          )
        )
    )
  )`;

  const evidenceSource = `(
    ${alias}.source_type <> 'evidence'
    OR ${detached}
    OR EXISTS (
      SELECT 1
      FROM evidence_items visibility_evidence
      WHERE visibility_evidence.id = ${alias}.source_id
        AND visibility_evidence.library_id = ${alias}.library_id
        AND visibility_evidence.deleted_at IS NULL
        AND visibility_evidence.work_id IS ${alias}.work_id
        AND visibility_evidence.asset_id IS ${alias}.asset_id
        AND visibility_evidence.revision_id IS ${alias}.revision_id
    )
  )`;

  return `(${activeWork} AND ${activeAsset} AND ${activeRevision} AND ${pdfSource} AND ${annotationSource} AND ${evidenceSource})`;
}

/** Appends the canonical predicate to an existing parameterized clause list. */
export function appendContentUnitCanonicalVisibilityClause(
  clauses: string[],
  options: ContentUnitVisibilityOptions = {},
): void {
  clauses.push(contentUnitCanonicalVisibilitySql(options));
}

function assertSqlAlias(alias: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error("ContentUnit visibility SQL alias is invalid");
  }
}
