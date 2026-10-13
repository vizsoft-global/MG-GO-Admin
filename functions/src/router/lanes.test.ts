import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEAVY_FUNCTIONS,
  SCAN_FUNCTIONS,
  WORKER_HTTP_FUNCTIONS,
  functionsForLane,
  isDriverAppCallable,
  laneOf,
} from "./lanes";
import { allLegacyNames, moduleForFunction, routerRequirePath } from "./legacy-modules";

function allLaneCoverage(): string[] {
  return [
    ...functionsForLane("light"),
    ...functionsForLane("scan"),
    ...functionsForLane("heavy"),
    ...allLegacyNames().filter((name) => isDriverAppCallable(name)),
    ...WORKER_HTTP_FUNCTIONS,
  ];
}

describe("lane membership", () => {
  it("partitions every legacy export across one lane or an exclusion", () => {
    const all = allLegacyNames();
    assert.equal(new Set(all).size, all.length);
    assert.deepEqual(allLaneCoverage().slice().sort(), all.slice().sort());
    for (const name of SCAN_FUNCTIONS) assert.equal(laneOf(name), "scan", name);
    for (const name of HEAVY_FUNCTIONS) assert.equal(laneOf(name), "heavy", name);
    for (const name of WORKER_HTTP_FUNCTIONS) assert.equal(laneOf(name), null, name);
  });

  it("keeps rider callables off the admin lanes and the audit health check on light", () => {
    assert.equal(laneOf("driverPasscodeLogin"), null);
    assert.equal(isDriverAppCallable("driverOpsAuditHealth"), false);
    assert.equal(laneOf("driverOpsAuditHealth"), "light");
    assert.equal(laneOf("syncStaffClaims"), "light");
    assert.equal(laneOf("adminPerfPing"), "light");
    assert.equal(laneOf("esignComposeSignedDocument"), "heavy");
    assert.equal(laneOf("notAFunction"), null);
  });

  it("points the router require path one directory deeper than index", () => {
    assert.equal(moduleForFunction("adminPerfPing"), "./rpcs/perf-ping");
    assert.equal(routerRequirePath("adminPerfPing"), "../rpcs/perf-ping");
    assert.equal(routerRequirePath("syncStaffClaims"), "../rpcs/sync-staff-claims");
    assert.equal(moduleForFunction("workerFleetRead"), "./rpcs/fleet-worker-http");
  });
});
