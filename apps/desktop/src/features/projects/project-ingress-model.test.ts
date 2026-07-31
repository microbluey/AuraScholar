import { describe, expect, it } from "vitest";
import {
  normalizeNewProjectName,
  normalizeProjectIngressRequest,
  normalizeProjectTargets,
  projectIngressDescription,
  resolveDefaultProjectTargetId,
} from "./project-ingress-model";

describe("project ingress model", () => {
  it("normalizes a shared single-or-bulk work request", () => {
    expect(
      normalizeProjectIngressRequest({
        sourceLabel: "  Attention Is All You Need  ",
        workIds: [" work-a ", "work-b", "work-a"],
      }),
    ).toEqual({
      sourceLabel: "Attention Is All You Need",
      workIds: ["work-a", "work-b"],
    });
    expect(() => normalizeProjectIngressRequest({ workIds: [] })).toThrow("请至少选择一篇文献");
    expect(() => normalizeProjectIngressRequest({ workIds: [""] })).toThrow("文献标识无效");
  });

  it("normalizes project targets and rejects ambiguous identities", () => {
    expect(
      normalizeProjectTargets([
        { description: "  Evidence map  ", id: " project-a ", name: " Project A " },
      ]),
    ).toEqual([
      {
        description: "Evidence map",
        id: "project-a",
        name: "Project A",
      },
    ]);
    expect(() =>
      normalizeProjectTargets([
        { id: "project-a", name: "A" },
        { id: "project-a", name: "B" },
      ]),
    ).toThrow("重复条目");
  });

  it("prefers the active project, then the recent project, then the first project", () => {
    const projects = [
      { id: "project-a", name: "A" },
      { id: "project-b", name: "B" },
    ];
    expect(resolveDefaultProjectTargetId(projects, "project-a", "project-b")).toBe("project-a");
    expect(resolveDefaultProjectTargetId(projects, "missing", "project-b")).toBe("project-b");
    expect(resolveDefaultProjectTargetId(projects, null, "missing")).toBe("project-a");
    expect(resolveDefaultProjectTargetId([], null, null)).toBe("");
  });

  it("validates inline project creation and describes single and bulk ingress", () => {
    expect(normalizeNewProjectName("  Causal   Inference  ")).toBe("Causal Inference");
    expect(() => normalizeNewProjectName(" ")).toThrow("请输入研究项目名称");
    expect(() => normalizeNewProjectName("a".repeat(81))).toThrow("不能超过 80");
    expect(projectIngressDescription("Paper A", 1)).toContain("「Paper A」");
    expect(projectIngressDescription(undefined, 3)).toContain("3 篇文献");
  });
});
