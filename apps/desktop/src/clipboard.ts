type ClipboardSmokeWindow = Window & {
  __AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__?: string | null;
};

const CLIPBOARD_DENIED_MESSAGE =
  "当前系统暂时拒绝写入剪贴板，请检查剪贴板权限后重试。";
const CLIPBOARD_UNSUPPORTED_MESSAGE =
  "当前环境不支持剪贴板写入，请手动选择内容复制。";

export async function writeClipboardText(text: string): Promise<void> {
  const smokeError = (window as ClipboardSmokeWindow).__AURASCHOLAR_SMOKE_CLIPBOARD_WRITE_ERROR__;
  if (smokeError) throw new Error(smokeError);

  let clipboardError: unknown = null;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const aura = (window as Window & { aura?: Window["aura"] }).aura;
  if (aura?.clipboard?.writeText) {
    try {
      await aura.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (document.execCommand("copy")) return;
  } catch (error) {
    clipboardError = error;
  } finally {
    document.body.removeChild(textarea);
  }

  throw clipboardWriteError(clipboardError);
}

function clipboardWriteError(cause: unknown): Error {
  if (cause instanceof Error) return new Error(CLIPBOARD_DENIED_MESSAGE, { cause });
  return new Error(CLIPBOARD_UNSUPPORTED_MESSAGE);
}
