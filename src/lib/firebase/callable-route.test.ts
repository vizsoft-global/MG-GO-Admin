import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAdminCallableRequest } from "./callable-route";

const projectId = "musallam-delivery-prod";
const region = "me-central1";
const args = { p_limit: 1 };

function route(routerMode: string | undefined, rpcName: string, timeoutMs?: number) {
  return resolveAdminCallableRequest({
    routerMode,
    projectId,
    region,
    rpcName,
    args,
    timeoutMs,
  });
}

describe("admin callable route", () => {
  it("uses the legacy function name when the router is off", () => {
    const resolved = route("off", "admin_list_requests");
    assert.equal(resolved.lane, null);
    assert.equal(resolved.functionName, "adminListRequests");
    assert.equal(
      resolved.url,
      "https://me-central1-musallam-delivery-prod.cloudfunctions.net/adminListRequests",
    );
    assert.deepEqual(resolved.body, { data: args });
  });

  it("uses the lane URL when the router is on", () => {
    for (const routerMode of [undefined, "", "on"]) {
      const resolved = route(routerMode, "admin_list_requests");
      assert.equal(resolved.lane, "light", String(routerMode));
      assert.equal(
        resolved.url,
        "https://me-central1-musallam-delivery-prod.cloudfunctions.net/adminApi",
      );
      assert.deepEqual(resolved.body, { data: { fn: "adminListRequests", data: args } });
    }
  });

  it("keeps rider and worker calls on the legacy URL", () => {
    const rider = route(undefined, "driver_get_home_dashboard");
    assert.equal(rider.lane, null);
    assert.equal(rider.url.endsWith("/driverGetHomeDashboard"), true);
    assert.deepEqual(rider.body, { data: args });

    const worker = route(undefined, "workerFleetRead");
    assert.equal(worker.lane, null);
    assert.equal(worker.url.endsWith("/workerFleetRead"), true);
  });

  it("raises the client timeout to the lane timeout", () => {
    assert.equal(route(undefined, "admin_performance_ops_snapshot").url.endsWith("/adminApiScan"), true);
    assert.equal(route(undefined, "admin_performance_ops_snapshot").timeoutMs, 120_000);
    assert.equal(route(undefined, "recalculate_earnings_for_range").url.endsWith("/adminApiHeavy"), true);
    assert.equal(route(undefined, "recalculate_earnings_for_range", 5_000).timeoutMs, 300_000);
    assert.equal(route(undefined, "admin_perf_ping", 400_000).timeoutMs, 400_000);
    assert.equal(route("off", "recalculate_earnings_for_range", 5_000).timeoutMs, 5_000);
  });

  /**
   * The compare page reported "RPC not live" because this multi-collection scan
   * sat on the light lane's 60s budget. It is a scan-lane member now, and this
   * assertion is what keeps it there.
   */
  it("routes the order comparison snapshot to the scan lane", () => {
    const resolved = route(undefined, "admin_order_comparison_snapshot");
    assert.equal(resolved.lane, "scan");
    assert.equal(resolved.functionName, "adminOrderComparisonSnapshot");
    assert.equal(
      resolved.url,
      "https://me-central1-musallam-delivery-prod.cloudfunctions.net/adminApiScan",
    );
    assert.equal(resolved.timeoutMs, 120_000);
  });

  it("routes the order recon compare to the scan lane", () => {
    const resolved = route(undefined, "admin_order_recon_compare");
    assert.equal(resolved.lane, "scan");
    assert.equal(resolved.functionName, "adminOrderReconCompare");
    assert.equal(
      resolved.url,
      "https://me-central1-musallam-delivery-prod.cloudfunctions.net/adminApiScan",
    );
    assert.equal(resolved.timeoutMs, 120_000);
  });

  it("leaves a name without underscores unchanged", () => {
    const resolved = route(undefined, "syncStaffClaims");
    assert.equal(resolved.functionName, "syncStaffClaims");
    assert.equal(resolved.lane, "light");
    assert.equal(resolved.url.endsWith("/adminApi"), true);
  });
});
