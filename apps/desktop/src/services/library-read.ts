import { AttachmentsRepo } from "@aurascholar/db/repos/attachments";
import { getDb } from "./aura-db";
import { blobPath, auraFs } from "./aura-platform";
import { describeSafeError } from "./sensitive-text";

export async function loadPdfForWork(
  workId: string,
  preferredAttachmentId?: string,
): Promise<{ attachmentId: string; data: Uint8Array } | null> {
  const db = await getDb();
  const attachments = new AttachmentsRepo(db);
  const list = await attachments.forWork(workId);
  let pdfs = list
    .filter((a) => a.kind === "pdf")
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  if (pdfs.length === 0) return null;
  if (preferredAttachmentId) {
    const preferred = pdfs.find((pdf) => pdf.id === preferredAttachmentId);
    if (!preferred) throw new Error("指定的 PDF 附件不存在或已被移除");
    pdfs = [preferred];
  }

  let lastError: unknown = null;
  for (const pdf of pdfs) {
    try {
      const path = blobPath(pdf.sha256);
      const exists = await auraFs.exists(path);
      if (!exists) {
        lastError = new Error(`blob missing:${path}`);
        continue;
      }
      const data = await auraFs.readFile(path);
      return { attachmentId: pdf.id, data };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = describeSafeError(lastError);
  throw new Error(`PDF 附件文件无法读取:${detail}`);
}
