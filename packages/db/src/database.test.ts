import { describe, expect, it } from "vitest";
import { createNodeDatabase } from "./database";

describe("node SQLite driver capability", () => {
  it("exposes extension loading as an optional Database capability", async () => {
    const database = await createNodeDatabase(":memory:");

    expect(typeof database.loadExtension).toBe("function");
  });
});
