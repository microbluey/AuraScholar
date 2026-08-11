/**
 * Renderer facade for the main-owned OA acquisition flow. A renderer can ask
 * only for an existing work; it never receives publisher URLs, PDF bytes, or
 * a staged-PDF receipt that could be reused outside the durable attach.
 */
export async function ensureOaPdfAttachment(workId: string): Promise<boolean> {
  const result = await window.aura.data.command("library.ensureOaPdfAttachment", { workId });
  return result.attached;
}
