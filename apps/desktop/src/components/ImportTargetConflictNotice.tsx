import { Badge } from "@aurascholar/ui";
import type { IngestDraft } from "../services/library-types";

export function ImportTargetConflictNotice({ draft }: { draft: IngestDraft }) {
  if (!draft.targetConflict) return null;
  return (
    <div className="import-confirm__warning" role="alert" aria-live="assertive" aria-atomic="true">
      <Badge variant="warning">发现重复</Badge>
      <div>
        <strong>这份 PDF 已出现在《{draft.targetConflict.title}》</strong>
        <p>
          当前补全文目标仍是《{draft.targetTitle ?? "所选文献"}》。请核对后再确认挂载，
          系统不会自动改挂到已有文献。
        </p>
      </div>
    </div>
  );
}
