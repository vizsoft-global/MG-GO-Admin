import assert from "node:assert/strict";
import test from "node:test";
import { WORKER_HTTP_CAPACITY } from "./worker-http-capacity";

test("worker ingest doors stay above the free-plan 429 that falls back to Firestore", () => {
  assert.equal(WORKER_HTTP_CAPACITY.cpu, 1);
  assert.equal(WORKER_HTTP_CAPACITY.concurrency, 40);
  assert.equal(WORKER_HTTP_CAPACITY.maxInstances, 20);
  assert.equal(WORKER_HTTP_CAPACITY.minInstances, 1);
  assert.equal(WORKER_HTTP_CAPACITY.timeoutSeconds, 120);
});
