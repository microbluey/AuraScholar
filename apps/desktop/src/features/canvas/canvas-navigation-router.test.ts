import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router-dom";

const routers: Array<ReturnType<typeof createMemoryRouter>> = [];

function createRouter(): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter([{ path: "*", element: null }], {
    initialEntries: ["/canvas/workspace-a"],
  });
  routers.push(router);
  return router;
}

afterEach(() => {
  for (const router of routers.splice(0)) router.dispose();
});

describe("Canvas router blocker", () => {
  it("replaces a pending target so rapid navigation releases only the latest location", async () => {
    const router = createRouter();
    router.getBlocker("canvas", () => true);

    await router.navigate("/library");
    expect(router.state.location.pathname).toBe("/canvas/workspace-a");
    expect(router.state.blockers.get("canvas")).toMatchObject({
      location: { pathname: "/library" },
      state: "blocked",
    });

    await router.navigate("/settings");
    const latestBlocker = router.state.blockers.get("canvas");
    expect(latestBlocker).toMatchObject({
      location: { pathname: "/settings" },
      state: "blocked",
    });

    latestBlocker?.proceed?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.state.location.pathname).toBe("/settings");
    expect(router.state.blockers.get("canvas")?.state).toBe("unblocked");
  });
});
