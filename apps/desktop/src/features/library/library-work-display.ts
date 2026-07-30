interface WorkNotePreviewLike {
  content_md: string | null;
  type: string;
}

export function libraryTagTone(label: string, index: number) {
  if (/arxiv/i.test(label)) return "teal";
  if (/doi/i.test(label)) return "blue";
  if (label === "阅读中") return "green";
  if (label === "已读") return "purple";
  return ["teal", "blue", "purple", "amber", "green"][index % 5] ?? "teal";
}

export function readingStatusLabel(status: string) {
  if (status === "reading") return "阅读中";
  if (status === "read") return "已读";
  return "未读";
}

export function annotationTypeLabel(type: string) {
  const labels: Record<string, string> = {
    highlight: "高亮",
    underline: "下划线",
    strikeout: "删除线",
    note: "笔记",
    ink: "手写",
  };
  return labels[type] ?? "批注";
}

export function notePreviewText(note: WorkNotePreviewLike) {
  const content = note.content_md?.replace(/\s+/g, " ").trim();
  return content || `${annotationTypeLabel(note.type)}批注，尚未填写笔记内容。`;
}

export function formatLibraryDateTime(value: number) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatAttachmentSource(source: string | null) {
  if (!source) return "来源未知";
  const labels: Record<string, string> = {
    manual: "手动上传",
    preview: "示例文件",
    "research-download": "检索下载",
    unpaywall: "Unpaywall",
    arxiv: "arXiv",
    openalex: "OpenAlex",
  };
  return labels[source] ?? source;
}
