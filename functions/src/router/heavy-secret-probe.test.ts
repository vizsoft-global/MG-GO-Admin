import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ADMIN_PERF_PING_HEAVY_SECRET, adminPerfPingHeavySecret } from "./heavy-secret-probe";

const SENTINEL = "stage-b-secret-sentinel-do-not-log";

describe("heavy secret probe", () => {
  it("reports whether the lane secret resolved without returning the value", async () => {
    const previous = process.env.WORKER_SHARED_SECRET;
    const lines: string[] = [];
    const info = console.info;
    const warn = console.warn;
    const error = console.error;
    const log = console.log;
    const capture = (...args: unknown[]) => {
      lines.push(args.map((item) => String(item)).join(" "));
    };
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    console.log = capture;
    try {
      process.env.WORKER_SHARED_SECRET = SENTINEL;
      const present = await adminPerfPingHeavySecret.run({ data: {} });
      assert.deepEqual(present, { secretResolved: true });
      delete process.env.WORKER_SHARED_SECRET;
      const absent = await adminPerfPingHeavySecret.run({ data: {} });
      assert.deepEqual(absent, { secretResolved: false });
      const endpoint = adminPerfPingHeavySecret.__endpoint as {
        secretEnvironmentVariables?: { key: string }[];
      };
      assert.deepEqual(
        endpoint.secretEnvironmentVariables?.map((item) => item.key),
        ["WORKER_SHARED_SECRET"],
      );
    } finally {
      console.info = info;
      console.warn = warn;
      console.error = error;
      console.log = log;
      if (previous === undefined) delete process.env.WORKER_SHARED_SECRET;
      else process.env.WORKER_SHARED_SECRET = previous;
    }
    const dumped = lines.join("\n");
    assert.equal(dumped.includes(SENTINEL), false);
    const indexSrc = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    assert.equal(indexSrc.includes(ADMIN_PERF_PING_HEAVY_SECRET), false);
    assert.equal(indexSrc.includes("heavy-secret-probe"), false);
  });
});
