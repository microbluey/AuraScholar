import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig, runVectorEngineBenchmark } from "./vector-engine-benchmark.mjs";

describe("vector engine benchmark", () => {
  it("accepts pnpm's argument separator and preserves source-filter settings", () => {
    const config = parseConfig([
      "--",
      "--engine",
      "sqlite-vec",
      "--count",
      "12",
      "--source-count",
      "4",
      "--allowed-source-count",
      "2",
      "--warmup",
      "0",
    ]);

    assert.equal(config.engine, "sqlite-vec");
    assert.equal(config.count, 12);
    assert.equal(config.sourceCount, 4);
    assert.equal(config.allowedSourceCount, 2);
    assert.equal(config.warmupQueries, 0);
  });

  it("rejects a source filter that cannot describe the requested corpus", () => {
    assert.throws(
      () => parseConfig(["--count", "2", "--source-count", "3"]),
      /Source count cannot exceed vector count/,
    );
    assert.throws(
      () => parseConfig(["--count", "4", "--source-count", "2", "--allowed-source-count", "3"]),
      /Allowed source count cannot exceed source count/,
    );
  });

  it("runs a filtered sqlite-vec smoke benchmark with stable latency fields", async () => {
    const result = await runVectorEngineBenchmark([
      "--engine",
      "sqlite-vec",
      "--count",
      "128",
      "--dimensions",
      "8",
      "--queries",
      "20",
      "--warmup",
      "2",
      "--source-count",
      "8",
      "--allowed-source-count",
      "2",
    ]);

    assert.equal(result.benchmarkVersion, 2);
    assert.equal(result.querySamples, 20);
    assert.equal(result.queryWarmupCount, 2);
    assert.equal(result.allowedSourceCount, 2);
    assert.equal(result.sourceCount, 8);
    assert.equal(result.filterSelectivity, 0.25);
    assert.equal(result.selfRecallAt10, 1);
    assert.ok(result.queryFirstMs >= 0);
    assert.ok(result.queryP95Ms >= result.queryMedianMs);
    assert.ok(result.queryP99Ms >= result.queryP95Ms);
    assert.ok(result.peakRssBytes > 0);
  });
});
