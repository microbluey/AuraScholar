import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { assertBackupPayloadByteLength, backupPayloadByteLength } from "./library-backup-commands";

describe("Library backup IPC payload sizing", () => {
  it("counts JSON escaping and UTF-8 bytes rather than JavaScript string length", () => {
    const backupText = "\u0000\n😀".repeat(20);
    const rawUtf8Bytes = Buffer.byteLength(backupText, "utf8");
    const serializedBytes = backupPayloadByteLength(backupText, "import");

    expect(serializedBytes).toBeGreaterThan(rawUtf8Bytes);
    // Under a character-count limit this 80-code-unit text would fit easily.
    // Its JSON-escaped IPC envelope is intentionally rejected by this small
    // byte budget, covering the control-character expansion regression.
    expect(() => assertBackupPayloadByteLength(backupText, "import", 200)).toThrow(
      "Backup file is too large",
    );
  });
});
