import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ResearchProjectSwitcher,
  resolveResearchProjectSwitcherFocusIndex,
  resolveResearchProjectSwitcherNavigationIndex,
  resolveResearchProjectSwitcherTriggerKey,
} from "./ResearchProjectSwitcher";
import type { ResearchProjectSummary } from "./model";

const PROJECTS: ResearchProjectSummary[] = [
  {
    createdAt: 1,
    id: "project-a",
    name: "Project A",
    sourceCount: 2,
    status: "active",
    updatedAt: 2,
  },
  {
    createdAt: 2,
    id: "project-b",
    name: "Project B",
    sourceCount: 3,
    status: "active",
    updatedAt: 3,
  },
];

describe("ResearchProjectSwitcher keyboard behavior", () => {
  it("maps trigger arrow keys to standard first and last menu focus", () => {
    expect(resolveResearchProjectSwitcherTriggerKey("ArrowDown")).toBe("first");
    expect(resolveResearchProjectSwitcherTriggerKey("ArrowUp")).toBe("last");
    expect(resolveResearchProjectSwitcherTriggerKey("Enter")).toBeNull();
  });

  it("resolves click, ArrowDown, and ArrowUp opening focus targets", () => {
    expect(resolveResearchProjectSwitcherFocusIndex("current", 1, 3)).toBe(1);
    expect(resolveResearchProjectSwitcherFocusIndex("current", -1, 3)).toBe(0);
    expect(resolveResearchProjectSwitcherFocusIndex("first", 1, 3)).toBe(0);
    expect(resolveResearchProjectSwitcherFocusIndex("last", 1, 3)).toBe(2);
    expect(resolveResearchProjectSwitcherFocusIndex("current", -1, 0)).toBe(-1);
  });

  it("supports wrapped arrow navigation plus Home and End", () => {
    expect(resolveResearchProjectSwitcherNavigationIndex("ArrowDown", 1, 2)).toBe(0);
    expect(resolveResearchProjectSwitcherNavigationIndex("ArrowUp", 0, 2)).toBe(1);
    expect(resolveResearchProjectSwitcherNavigationIndex("ArrowDown", -1, 3)).toBe(0);
    expect(resolveResearchProjectSwitcherNavigationIndex("ArrowUp", -1, 3)).toBe(2);
    expect(resolveResearchProjectSwitcherNavigationIndex("Home", 1, 2)).toBe(0);
    expect(resolveResearchProjectSwitcherNavigationIndex("End", 0, 2)).toBe(1);
    expect(resolveResearchProjectSwitcherNavigationIndex("Escape", 0, 2)).toBeNull();
    expect(resolveResearchProjectSwitcherNavigationIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("renders an accessible collapsed menu trigger", () => {
    const markup = renderToStaticMarkup(
      <ResearchProjectSwitcher
        busyAction={null}
        onCreate={vi.fn(async () => true)}
        onRename={vi.fn(async () => true)}
        onSelect={vi.fn()}
        project={PROJECTS[1]!}
        projects={PROJECTS}
      />,
    );

    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Project B");
  });
});
