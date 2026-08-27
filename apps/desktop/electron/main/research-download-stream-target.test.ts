import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createResearchDownloadStreamTarget,
  MAX_RESEARCH_DOWNLOAD_STREAM_TARGET_ATTEMPTS,
} from "./research-download-stream-target";

const roots: string[] = [];
const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

async function root(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), "aurascholar-research-stream-"));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("research stream download targets", () => {
  it("isolates a new payload under an atomically created parent directory", async () => {
    const userDataRoot = await root();

    const target = createResearchDownloadStreamTarget(userDataRoot, { id: () => FIRST_ID });

    expect(target.absolutePath).toBe(join(target.directory, "download"));
    await expect(fs.stat(target.directory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(fs.access(target.absolutePath)).rejects.toThrow();
  });

  it("retries directory collisions without touching an existing payload", async () => {
    const userDataRoot = await root();
    const existing = createResearchDownloadStreamTarget(userDataRoot, { id: () => FIRST_ID });
    await fs.writeFile(existing.absolutePath, new Uint8Array([9]));
    const ids = [FIRST_ID, SECOND_ID];

    const target = createResearchDownloadStreamTarget(userDataRoot, { id: () => ids.shift()! });

    expect(target.directoryName).toBe(`.stream-${SECOND_ID}`);
    expect(new Uint8Array(await fs.readFile(existing.absolutePath))).toEqual(new Uint8Array([9]));
    await expect(fs.access(target.absolutePath)).rejects.toThrow();
  });

  it("fails after bounded directory collisions without deleting existing payloads", async () => {
    const userDataRoot = await root();
    const ids = Array.from(
      { length: MAX_RESEARCH_DOWNLOAD_STREAM_TARGET_ATTEMPTS },
      (_, index) =>
        `${String(index + 3).repeat(8)}-${String(index + 3).repeat(4)}-4${String(index + 3).repeat(3)}-8${String(index + 3).repeat(3)}-${String(index + 3).repeat(12)}`,
    );
    for (const id of ids) {
      const target = createResearchDownloadStreamTarget(userDataRoot, { id: () => id });
      await fs.writeFile(target.absolutePath, new Uint8Array([ids.indexOf(id)]));
    }

    let attempts = 0;
    expect(() =>
      createResearchDownloadStreamTarget(userDataRoot, { id: () => ids[attempts++]! }),
    ).toThrow("already in use");
    for (const [index, id] of ids.entries()) {
      const path = join(userDataRoot, "research-downloads", `.stream-${id}`, "download");
      expect(new Uint8Array(await fs.readFile(path))).toEqual(new Uint8Array([index]));
    }
  });
});
