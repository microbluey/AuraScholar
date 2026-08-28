import { describe, expect, it } from "vitest";
import {
  createPreviewSentinelTask,
  getPreviewSentinelEventEvidence,
  previewSentinelEvents,
  previewSentinelTasks,
  simulatePreviewPoll,
} from "./sentinel-preview";

describe("Sentinel browser preview", () => {
  it("returns isolated task and evidence snapshots", () => {
    const firstTasks = previewSentinelTasks();
    const firstEvents = previewSentinelEvents();
    firstTasks[0]!.title = "Changed locally";
    firstEvents.get("preview-sentinel-attention")?.splice(0);

    expect(previewSentinelTasks()[0]?.title).toBe("Attention Is All You Need");
    expect(previewSentinelEvents().get("preview-sentinel-attention")).toHaveLength(4);
    const event = previewSentinelEvents().get("preview-sentinel-attention")?.[0];
    expect(event).toMatchObject({ evidenceStatus: "available" });
    expect(event).not.toHaveProperty("evidence_json");
    expect(getPreviewSentinelEventEvidence(event!.id)).toMatchObject({
      evidenceJson: expect.stringContaining('"preview": true'),
      status: "available",
    });
  });

  it("normalizes DOI tasks and preserves title-monitor hints", () => {
    expect(
      createPreviewSentinelTask({
        mode: "doi",
        doi: "https://doi.org/10.4242/PREVIEW",
        title: "",
        hintVenue: "ignored",
        hintAuthor: "ignored",
      }),
    ).toMatchObject({
      doi: "10.4242/preview",
      hint_author: null,
      hint_venue: null,
      title: "10.4242/preview",
    });
    expect(
      createPreviewSentinelTask({
        mode: "title",
        doi: "",
        title: "  A title monitor  ",
        hintVenue: "  Venue  ",
        hintAuthor: "  Author  ",
      }),
    ).toMatchObject({
      doi: null,
      hint_author: "Author",
      hint_venue: "Venue",
      title: "A title monitor",
    });
  });

  it("advances only selected active tasks and appends evidence", () => {
    const activeTask = createPreviewSentinelTask({
      mode: "title",
      doi: "",
      title: "Active",
      hintVenue: "",
      hintAuthor: "",
    });
    const pausedTask = {
      ...createPreviewSentinelTask({
        mode: "title",
        doi: "",
        title: "Paused",
        hintVenue: "",
        hintAuthor: "",
      }),
      status: "paused",
    };

    const result = simulatePreviewPoll(
      [activeTask, pausedTask],
      new Map([
        [activeTask.id, []],
        [pausedTask.id, []],
      ]),
      [activeTask.id, pausedTask.id],
    );

    expect(result).toMatchObject({ changes: 1, checked: 1 });
    expect(result.tasks.find((task) => task.id === activeTask.id)?.current_state).toBe(
      "registered",
    );
    expect(result.tasks.find((task) => task.id === pausedTask.id)?.current_state).toBe("accepted");
    expect(result.eventsByTask.get(activeTask.id)).toHaveLength(1);
    expect(result.eventsByTask.get(pausedTask.id)).toHaveLength(0);
  });
});
