import type { RefObject } from "react";
import { LibraryKnowledgeTools } from "./LibraryKnowledgeTools";

export interface LibraryUtilityControlsProps {
  enabled: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachPdf: (file: File) => void | Promise<void>;
  onMessage: (message: string) => void;
  onReferencesFile: (file: File) => void | Promise<void>;
  onSelectWork: (workId: string | null) => void;
  onUploadFile: (file: File) => void | Promise<void>;
  referenceImportAccept: string;
  refsInputRef: RefObject<HTMLInputElement | null>;
  selectedPdfInputRef: RefObject<HTMLInputElement | null>;
}

/** Keeps hidden file controls and global Knowledge tools out of the page composition. */
export function LibraryUtilityControls({
  enabled,
  fileInputRef,
  onAttachPdf,
  onMessage,
  onReferencesFile,
  onSelectWork,
  onUploadFile,
  referenceImportAccept,
  refsInputRef,
  selectedPdfInputRef,
}: LibraryUtilityControlsProps) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void onUploadFile(file);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={selectedPdfInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void onAttachPdf(file);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={refsInputRef}
        type="file"
        accept={referenceImportAccept}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void onReferencesFile(file);
          event.currentTarget.value = "";
        }}
      />
      <LibraryKnowledgeTools enabled={enabled} onMessage={onMessage} onSelectWork={onSelectWork} />
    </>
  );
}
