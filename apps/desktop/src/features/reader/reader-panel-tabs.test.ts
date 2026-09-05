import { describe, expect, it } from "vitest";
import {
  normalizeReaderPanelTab,
  readerPanelTabIsMounted,
  readerPanelTabs,
} from "./reader-panel-tabs";

describe("reader panel tabs", () => {
  it("recognizes the document synthesis tab only as a supported reader tab", () => {
    expect(normalizeReaderPanelTab("synthesis")).toBe("synthesis");
    expect(normalizeReaderPanelTab("unknown")).toBeNull();
  });

  it("keeps synthesis desktop-only while preserving the existing graph gate", () => {
    const tabs = readerPanelTabs({
      annotationCount: 2,
      canSynthesizeDocument: false,
      workDoi: undefined,
    });

    expect(tabs.find((tab) => tab.key === "annotations")?.label).toBe("批注 2");
    expect(tabs.find((tab) => tab.key === "synthesis")).toMatchObject({ disabled: true });
    expect(tabs.find((tab) => tab.key === "graph")).toMatchObject({ disabled: true });
  });

  it("keeps synthesis mounted across tab switches so a session draft is not lost", () => {
    expect(readerPanelTabIsMounted("synthesis", { graphMounted: false, workDoi: undefined })).toBe(
      true,
    );
    expect(readerPanelTabIsMounted("graph", { graphMounted: false, workDoi: "doi:one" })).toBe(
      false,
    );
  });
});
