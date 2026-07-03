import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { getDb } from "./tauri-db";
import { blobPath, tauriFs } from "./tauri-platform";

export async function loadPdfForWork(
  workId: string,
): Promise<{ attachmentId: string; data: Uint8Array } | null> {
  const db = await getDb();
  const attachments = new AttachmentsRepo(db);
  const list = await attachments.forWork(workId);
  const pdfs = list
    .filter((a) => a.kind === "pdf")
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  if (pdfs.length === 0) return null;

  let lastError: unknown = null;
  for (const pdf of pdfs) {
    try {
      const path = blobPath(pdf.sha256);
      const exists = await tauriFs.exists(path);
      if (!exists) {
        lastError = new Error(`blob missing:${path}`);
        continue;
      }
      const data = await tauriFs.readFile(path);
      return { attachmentId: pdf.id, data };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`PDF 附件文件无法读取:${detail}`);
}
