const REFERENCE_FILE_EXTENSIONS = new Set(["bib", "ris", "nbib", "enw", "json"]);

export function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes("Files") ||
    Array.from(dataTransfer.items).some((item) => item.kind === "file")
  );
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isSupportedImportFile(file: File): boolean {
  if (isPdfFile(file)) return true;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return REFERENCE_FILE_EXTENSIONS.has(extension);
}
