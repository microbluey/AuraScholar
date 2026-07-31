import { describe, expect, it } from "vitest";
import type { ResearchProjectSummary } from "./model";
import { researchProjectPath, resolveResearchProjectIndexPath } from "./routes";

function project(
  id: string,
  status: ResearchProjectSummary["status"] = "active",
): ResearchProjectSummary {
  return {
    createdAt: 1,
    id,
    name: id,
    sourceCount: 0,
    status,
    updatedAt: 1,
  };
}

describe("research project routes", () => {
  it("encodes project ids in RESTful routes", () => {
    expect(researchProjectPath("project:中文 / review")).toBe(
      "/projects/project%3A%E4%B8%AD%E6%96%87%20%2F%20review",
    );
  });

  it("restores the remembered active project", () => {
    expect(
      resolveResearchProjectIndexPath([project("project-a"), project("project-b")], "project-b"),
    ).toBe("/projects/project-b");
  });

  it("falls back to the first active project and ignores archived targets", () => {
    expect(
      resolveResearchProjectIndexPath(
        [project("archived", "archived"), project("active")],
        "archived",
      ),
    ).toBe("/projects/active");
    expect(resolveResearchProjectIndexPath([project("archived", "archived")], null)).toBeNull();
  });
});
