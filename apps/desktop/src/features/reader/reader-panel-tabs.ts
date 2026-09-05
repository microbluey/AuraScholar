export type ReaderPanelTab = "annotations" | "translate" | "graph" | "synthesis";

export interface ReaderPanelTabDefinition {
  readonly disabled?: boolean;
  readonly key: ReaderPanelTab;
  readonly label: string;
  readonly title?: string;
}

const READER_PANEL_TABS = new Set<ReaderPanelTab>([
  "annotations",
  "translate",
  "graph",
  "synthesis",
]);

export function normalizeReaderPanelTab(value: string | null): ReaderPanelTab | null {
  return value && READER_PANEL_TABS.has(value as ReaderPanelTab)
    ? (value as ReaderPanelTab)
    : null;
}

export function readerPanelTabs(input: {
  annotationCount: number;
  canSynthesizeDocument: boolean;
  workDoi: string | undefined;
}): readonly ReaderPanelTabDefinition[] {
  return [
    { key: "annotations", label: `批注 ${input.annotationCount}` },
    { key: "translate", label: "翻译" },
    {
      key: "synthesis",
      label: "证据合成",
      disabled: !input.canSynthesizeDocument,
      title: input.canSynthesizeDocument ? undefined : "仅桌面应用中已入库的 PDF 可进行证据合成",
    },
    {
      key: "graph",
      label: "脉络",
      disabled: !input.workDoi,
      title: input.workDoi ? undefined : "无 DOI,无法构建图谱",
    },
  ];
}

export function readerPanelTabIsMounted(
  tab: ReaderPanelTab,
  input: { graphMounted: boolean; workDoi: string | undefined },
): boolean {
  return (
    tab === "annotations" ||
    tab === "translate" ||
    tab === "synthesis" ||
    (tab === "graph" && Boolean(input.workDoi && input.graphMounted))
  );
}
