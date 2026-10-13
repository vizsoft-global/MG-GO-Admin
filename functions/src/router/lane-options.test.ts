import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  HEAVY_FUNCTIONS,
  LANE_FUNCTION_NAME,
  functionsForLane,
  laneOf,
  type LaneId,
} from "./lanes";
delete process.env.FUNCTION_TARGET;

type EndpointFn = { __endpoint?: Record<string, unknown>; run?: unknown };

const require = createRequire(import.meta.url);
const built = require("../../lib/index.js") as Record<string, EndpointFn>;
const router = require("../../lib/router/admin-api.js") as {
  loadLegacyHandler: (fn: string) => EndpointFn;
};

const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_MEMORY_MB = 256;
const DEFAULT_CPU = 0.08;

function endpointOf(name: string): Record<string, unknown> {
  const fn = built[name];
  assert.ok(fn?.__endpoint, `${name} has no __endpoint`);
  return JSON.parse(JSON.stringify(fn.__endpoint)) as Record<string, unknown>;
}

function timeoutOf(endpoint: Record<string, unknown>): number {
  return typeof endpoint.timeoutSeconds === "number" ? endpoint.timeoutSeconds : DEFAULT_TIMEOUT_SECONDS;
}

function memoryOf(endpoint: Record<string, unknown>): number {
  return typeof endpoint.availableMemoryMb === "number" ? endpoint.availableMemoryMb : DEFAULT_MEMORY_MB;
}

function cpuOf(endpoint: Record<string, unknown>): number {
  return typeof endpoint.cpu === "number" ? endpoint.cpu : DEFAULT_CPU;
}

function secretsOf(endpoint: Record<string, unknown>): string[] {
  const raw = endpoint.secretEnvironmentVariables;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) =>
      item && typeof item === "object" && "key" in item ? String((item as { key: unknown }).key) : String(item),
    )
    .sort();
}

function identity(endpoint: Record<string, unknown>, field: string): string {
  const value = endpoint[field];
  return value == null ? "" : JSON.stringify(value);
}

function assertIdentical(lane: LaneId, field: "serviceAccountEmail" | "enforceAppCheck" | "cors"): void {
  const members = functionsForLane(lane).map((name) => endpointOf(name));
  const values = new Set(members.map((endpoint) => identity(endpoint, field)));
  assert.equal(values.size, 1, `${lane} ${field} differs: ${[...values].join(" | ")}`);
  assert.equal(identity(endpointOf(LANE_FUNCTION_NAME[lane]), field), [...values][0]);
}

describe("lane options superset", () => {
  it("gives each lane at least the secrets, timeout, memory, and cpu of its members", () => {
    const lanes: LaneId[] = ["light", "scan", "heavy"];
    for (const lane of lanes) {
      const members = functionsForLane(lane);
      assert.ok(members.length > 0, lane);
      const laneEndpoint = endpointOf(LANE_FUNCTION_NAME[lane]);
      const laneSecrets = new Set(secretsOf(laneEndpoint));
      let maxTimeout = 0;
      let maxMemory = 0;
      let maxCpu = 0;
      for (const name of members) {
        const endpoint = endpointOf(name);
        for (const secret of secretsOf(endpoint)) {
          assert.equal(laneSecrets.has(secret), true, `${lane} missing secret ${secret} from ${name}`);
        }
        maxTimeout = Math.max(maxTimeout, timeoutOf(endpoint));
        maxMemory = Math.max(maxMemory, memoryOf(endpoint));
        maxCpu = Math.max(maxCpu, cpuOf(endpoint));
      }
      assert.ok(timeoutOf(laneEndpoint) >= maxTimeout, lane);
      assert.ok(memoryOf(laneEndpoint) >= maxMemory, lane);
      assert.ok(cpuOf(laneEndpoint) >= maxCpu, lane);
      assertIdentical(lane, "serviceAccountEmail");
      assertIdentical(lane, "enforceAppCheck");
      assertIdentical(lane, "cors");
    }
  });

  it("applies the planned lane capacity instead of the global 0.08 options", () => {
    const light = endpointOf("adminApi");
    assert.equal(light.cpu, 1);
    assert.equal(light.availableMemoryMb, 2048);
    assert.equal(light.concurrency, 8);
    assert.equal(light.maxInstances, 8);
    assert.equal(light.minInstances, 0);
    assert.equal(light.timeoutSeconds, null);

    const scan = endpointOf("adminApiScan");
    assert.equal(scan.cpu, 1);
    assert.equal(scan.availableMemoryMb, 4096);
    assert.equal(scan.concurrency, 2);
    assert.equal(scan.maxInstances, 6);
    assert.equal(scan.minInstances, 1);
    assert.equal(scan.timeoutSeconds, 120);

    const heavy = endpointOf("adminApiHeavy");
    assert.equal(heavy.cpu, 1);
    assert.equal(heavy.availableMemoryMb, 4096);
    assert.equal(heavy.concurrency, 1);
    assert.equal(heavy.maxInstances, 3);
    assert.equal(heavy.minInstances, 0);
    assert.equal(heavy.timeoutSeconds, 300);
    assert.deepEqual(secretsOf(heavy), []);
  });

  it("keeps esignComposeSignedDocument on heavy and the secret probe unpublished", () => {
    assert.equal(laneOf("esignComposeSignedDocument"), "heavy");
    assert.equal(HEAVY_FUNCTIONS.includes("esignComposeSignedDocument"), true);
    const esign = endpointOf("esignComposeSignedDocument");
    assert.equal(esign.cpu, 1);
    assert.equal(esign.availableMemoryMb, 1024);
    assert.equal(esign.timeoutSeconds, 120);
    assert.equal(built.adminPerfPingHeavySecret, undefined);
    const ping = router.loadLegacyHandler("adminPerfPing");
    assert.equal(typeof ping, "function");
    assert.equal(typeof ping.run, "function");
  });
});
