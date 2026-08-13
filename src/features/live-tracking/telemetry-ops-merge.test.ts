import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeTelemetryWithOperations } from "./telemetry-ops-merge";

const telemetry = [
  { id: "1", clientTs: "2026-08-13T09:04:00.000Z" },
  { id: "2", clientTs: "2026-08-13T09:12:00.000Z" },
];

const operations = [
  { id: "10", occurredAt: "2026-08-13T09:13:00.000Z" },
  { id: "11", occurredAt: "2026-08-13T09:01:00.000Z" },
];

describe("mergeTelemetryWithOperations", () => {
  it("returns telemetry only while the operations overlay is off", () => {
    const merged = mergeTelemetryWithOperations(telemetry, operations);
    assert.deepEqual(
      merged.map((entry) => entry.key),
      ["t:2", "t:1"],
    );
    assert.ok(merged.every((entry) => entry.kind === "telemetry"));
  });

  it("interleaves both streams newest first when enabled", () => {
    const merged = mergeTelemetryWithOperations(telemetry, operations, {
      includeOperations: true,
    });
    assert.deepEqual(
      merged.map((entry) => entry.key),
      ["o:10", "t:2", "t:1", "o:11"],
    );
  });

  it("keeps a shared timestamp in a deterministic order", () => {
    const sameTime = mergeTelemetryWithOperations(
      [{ id: "9", clientTs: "2026-08-13T09:00:00.000Z" }],
      [{ id: "9", occurredAt: "2026-08-13T09:00:00.000Z" }],
      { includeOperations: true },
    );
    assert.deepEqual(
      sameTime.map((entry) => entry.key),
      ["t:9", "o:9"],
    );
  });

  it("applies the limit after merging, not before", () => {
    const merged = mergeTelemetryWithOperations(telemetry, operations, {
      includeOperations: true,
      limit: 2,
    });
    assert.deepEqual(
      merged.map((entry) => entry.key),
      ["o:10", "t:2"],
    );
  });

  it("handles empty inputs", () => {
    assert.deepEqual(mergeTelemetryWithOperations([], [], { includeOperations: true }), []);
    assert.equal(mergeTelemetryWithOperations([], operations).length, 0);
  });
});
