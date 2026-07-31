import { describe, expect, it } from "vitest";
import { isActiveResearchProject } from "./types";

describe("isActiveResearchProject", () => {
  it("requires active status and no deletion tombstone", () => {
    expect(isActiveResearchProject({ status: "active" })).toBe(true);
    expect(isActiveResearchProject({ status: "archived" })).toBe(false);
    expect(isActiveResearchProject({ status: "active", deletedAt: 1 })).toBe(false);
  });
});
