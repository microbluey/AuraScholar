import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResultLineParser, parseResultLine, RESULT_PREFIX } from "./smoke-result.mjs";

describe("smoke result parsing", () => {
  it("parses a complete result line embedded in process output", () => {
    assert.deepEqual(parseResultLine(`before\n${RESULT_PREFIX}{"ok":true,"checks":2}\nafter\n`), {
      ok: true,
      checks: 2,
    });
  });

  it("buffers a result split across stdout chunks", () => {
    const results = [];
    const parser = createResultLineParser((result) => results.push(result));

    parser.push(`noise\n${RESULT_PREFIX}{"ok":`);
    parser.push('false,"failed":["library"]');
    assert.deepEqual(results, []);

    parser.push("}\ntrailing output\n");
    assert.deepEqual(results, [{ ok: false, failed: ["library"] }]);
  });

  it("flushes a final result line without a trailing newline", () => {
    const results = [];
    const parser = createResultLineParser((result) => results.push(result));

    parser.push(`${RESULT_PREFIX}{"ok":true}`);
    assert.deepEqual(results, []);

    parser.flush();
    assert.deepEqual(results, [{ ok: true }]);
  });
});
