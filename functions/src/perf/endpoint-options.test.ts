import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

/**
 * Compares the compiled bundle, which is what `firebase deploy` uploads.
 * Loading the TypeScript source under tsx exposes unset option getters as
 * circular objects; the built `__endpoint` is the deploy-time value.
 *
 * Stage A baseline, captured before the instrumentation edit.
 */
const BEFORE = {
  availableMemoryMb: 256,
  timeoutSeconds: null,
  minInstances: null,
  maxInstances: 2,
  ingressSettings: null,
  concurrency: 1,
  serviceAccountEmail: null,
  vpc: null,
  cpu: 0.08,
  region: ["me-central1"],
} as const;

const EXISTING = [
  "adminListDriversPage",
  "adminDriversFilterValues",
  "adminDeliveriesStatusCounts",
  "adminDeliveriesCountsByFilters",
  "adminLiveFleetSnapshot",
  "adminPerformanceOpsSnapshot",
  "adminListRequests",
  "adminListAttendanceDaily",
  "adminPayrollRuleSnapshot",
] as const;

type EndpointFn = { __endpoint?: Record<string, unknown> };

const require = createRequire(import.meta.url);
const built = require("../../lib/index.js") as Record<string, EndpointFn>;

function slim(fn: EndpointFn | undefined): Record<string, unknown> | null {
  const endpoint = fn?.__endpoint;
  if (!endpoint) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(endpoint)) {
    if (key === "callableTrigger" || key === "labels" || key === "platform") continue;
    out[key] = value;
  }
  // Unset options are ResetValue sentinels. Deploy serialises those as null,
  // which is the before/after diff the stage report shows.
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

describe("stage A endpoint options", () => {
  it("keeps the measured callables on the pre-change runtime options", () => {
    for (const name of EXISTING) {
      assert.deepEqual(slim(built[name]), BEFORE, name);
    }
  });

  it("gives the new ping the same global options and no secret", () => {
    const endpoint = slim(built.adminPerfPing);
    assert.deepEqual(endpoint, BEFORE);
    assert.equal(endpoint?.secretEnvironmentVariables, undefined);
  });
});
