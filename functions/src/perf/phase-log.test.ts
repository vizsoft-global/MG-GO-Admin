import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { logPhases, timedPhase } from "./phase-log";

describe("phase log", () => {
  it("records elapsed milliseconds and rethrows the read error", async () => {
    const phases: Record<string, number> = {};
    await assert.rejects(
      timedPhase(phases, "parallelMs", async () => {
        throw new Error("read failed");
      }),
      /read failed/,
    );
    assert.equal(typeof phases.parallelMs, "number");
    assert.ok(phases.parallelMs >= 0);
  });

  it("returns the value when storing the mark throws", async () => {
    const phases = new Proxy({} as Record<string, number>, {
      set() {
        throw new Error("mark failed");
      },
    });
    const value = await timedPhase(phases, "intakesMs", async () => 7);
    assert.equal(value, 7);
  });

  it("prints extra phase keys and keeps the four legacy keys", () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      logPhases("adminPayrollRuleSnapshot", { fanoutMs: 12, reconMs: 4 });
    } finally {
      console.info = original;
    }
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(parsed.fanoutMs, 12);
    assert.equal(parsed.reconMs, 4);
    assert.equal(parsed.driversGetAllMs, null);
    assert.equal(parsed.requireStaffMs, null);
  });

  it("swallows a logger failure", () => {
    const original = console.info;
    console.info = () => {
      throw new Error("log failed");
    };
    try {
      logPhases("adminListDriversPage", {});
    } finally {
      console.info = original;
    }
  });
});
