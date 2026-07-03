import { describe, expect, it } from "vitest";
import type { ConnectorContext } from "@aurascholar/connectors";
import { checkDoi } from "./check";

function ctx(
  route: (url: string) => { status: number; body?: unknown },
): ConnectorContext {
  return {
    mailto: "t@t.io",
    http: {
      async request(req: { url: string }) {
        const response = route(req.url);
        return {
          status: response.status,
          headers: {},
          body: new TextEncoder().encode(JSON.stringify(response.body ?? {})),
        };
      },
    },
  };
}

describe("checkDoi", () => {
  it("reports a failed DOI check when all evidence sources fail", async () => {
    await expect(
      checkDoi(
        ctx(() => ({ status: 403 })),
        "10.4242/aurascholar.failure",
        "accepted",
        [],
      ),
    ).rejects.toThrow(/DOI 检查失败:.*Crossref.*OpenAlex/);
  });

  it("continues when one source fails but the other returns evidence", async () => {
    const result = await checkDoi(
      ctx((url) =>
        url.includes("crossref.org")
          ? { status: 403 }
          : {
              status: 200,
              body: {
                id: "https://openalex.org/W4242",
                ids: { doi: "https://doi.org/10.4242/aurascholar.openalex" },
              },
            },
      ),
      "10.4242/aurascholar.openalex",
      "accepted",
      [],
    );

    expect(result.newMilestones.map((milestone) => milestone.state)).toContain("indexed_openalex");
  });

  it("treats not-found responses as a complete check with no new milestones", async () => {
    const result = await checkDoi(
      ctx(() => ({ status: 404 })),
      "10.4242/aurascholar.not-found",
      "accepted",
      [],
    );

    expect(result.newMilestones).toHaveLength(0);
    expect(result.highestState).toBe("accepted");
  });
});
