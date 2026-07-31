import { describe, expect, it } from "vitest";
import { previewResearchProjectService } from "./research-project-preview-service";

describe("previewResearchProjectService", () => {
  it("supports the complete project membership flow in browser preview", async () => {
    const created = await previewResearchProjectService.createProject(
      `Preview flow ${Date.now()}`,
      "A session-local project",
    );

    expect(created.sourceCount).toBe(0);
    const candidates = await previewResearchProjectService.searchLibraryWorks(created.id, "");
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.every((candidate) => !candidate.inProject)).toBe(true);

    const workId = candidates[0]!.workId;
    await expect(
      previewResearchProjectService.addWorks(created.id, [workId, workId]),
    ).resolves.toBe(1);
    await expect(previewResearchProjectService.addWorks(created.id, [workId])).resolves.toBe(0);

    const populated = await previewResearchProjectService.loadWorkspace(created.id);
    expect(populated.project?.sourceCount).toBe(1);
    expect(populated.sources.map((source) => source.workId)).toEqual([workId]);

    await expect(
      previewResearchProjectService.renameProject(created.id, "Stale rename", created.updatedAt),
    ).rejects.toThrow(/变化/);

    const revision = populated.project!.updatedAt;
    const renamed = await previewResearchProjectService.renameProject(
      created.id,
      "Renamed preview project",
      revision,
    );
    expect(renamed.name).toBe("Renamed preview project");

    await expect(previewResearchProjectService.removeWorks(created.id, [workId])).resolves.toBe(1);
    expect((await previewResearchProjectService.loadWorkspace(created.id)).sources).toEqual([]);
  });

  it("honors an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      previewResearchProjectService.listProjects({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
