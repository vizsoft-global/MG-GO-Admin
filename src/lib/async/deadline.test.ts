import assert from "node:assert/strict";
import test from "node:test";
import { withDeadline } from "./deadline";
import {
  cacheOpsSettings,
  clearOpsSettingsCache,
  readCachedOpsSettings,
} from "../firebase/ops-settings-cache";

const never = new Promise<never>(() => {});

test("withDeadline returns the value when the op settles in time", async () => {
  const result = await withDeadline(Promise.resolve("ok"), 50, () => "timeout");
  assert.equal(result, "ok");
});

test("withDeadline falls back when the op never settles", async () => {
  const result = await withDeadline(never, 10, () => "timeout");
  assert.equal(result, "timeout");
});

test("withDeadline does not hold the process open after resolving", async () => {
  // A leaked timer keeps a serverless invocation alive past its response.
  const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  await withDeadline(Promise.resolve("ok"), 60_000, () => "timeout");
  const after = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  assert.equal(after, before);
});

test("ops cache serves a claimed row within its TTL and expires after", () => {
  clearOpsSettingsCache();
  const row = { super_admin_claimed: true, maintenance_mode: false };

  cacheOpsSettings(row, 0);
  assert.deepEqual(readCachedOpsSettings(1_000), row);
  assert.equal(readCachedOpsSettings(60_001), null);
});

test("ops cache never caches an unclaimed super admin", () => {
  clearOpsSettingsCache();
  cacheOpsSettings({ super_admin_claimed: false, maintenance_mode: false }, 0);
  assert.equal(readCachedOpsSettings(1), null);
});

test("ops cache never caches a failed read", () => {
  clearOpsSettingsCache();
  cacheOpsSettings(null, 0);
  assert.equal(readCachedOpsSettings(1), null);
});
