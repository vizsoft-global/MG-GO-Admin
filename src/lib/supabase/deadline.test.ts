import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createTimeoutFetch, guardedRead, withDeadline } from "./deadline";
import {
  cacheOpsSettings,
  clearOpsSettingsCache,
  readCachedOpsSettings,
} from "./ops-settings-cache";

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

test("guardedRead reports a row", async () => {
  const read = await guardedRead(Promise.resolve({ data: { id: 1 }, error: null }), 50);
  assert.deepEqual(read, { data: { id: 1 }, failed: false });
});

test("guardedRead treats a genuinely absent row as a fact, not a failure", async () => {
  const read = await guardedRead(Promise.resolve({ data: null, error: null }), 50);
  assert.equal(read.failed, false);
  assert.equal(read.data, null);
});

test("guardedRead reports a query error as failed, not as an absent row", async () => {
  const read = await guardedRead(
    Promise.resolve({ data: null, error: { message: "boom" } }),
    50,
  );
  assert.equal(read.failed, true);
});

test("guardedRead swallows a rejection instead of throwing", async () => {
  const read = await guardedRead(Promise.reject(new Error("socket")), 50);
  assert.equal(read.failed, true);
});

test("guardedRead reports a hung read as failed", async () => {
  const read = await guardedRead(never, 10);
  assert.equal(read.failed, true);
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

test("createTimeoutFetch aborts a hung request", async () => {
  const server = http.createServer(() => {
    /* never respond */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const timedFetch = createTimeoutFetch(40);
  await assert.rejects(
    () => timedFetch(`http://127.0.0.1:${address.port}/`),
    (error: unknown) =>
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"),
  );
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

test("ops cache never caches a failed read", () => {
  clearOpsSettingsCache();
  cacheOpsSettings(null, 0);
  assert.equal(readCachedOpsSettings(1), null);
});
