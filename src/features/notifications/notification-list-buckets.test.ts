import assert from "node:assert/strict";
import test from "node:test";
import { parseListBucket, statusesForListBucket } from "./notification-list-buckets";

test("sent and drafts are status groups, all is unfiltered", () => {
  assert.equal(statusesForListBucket("all"), null);
  assert.deepEqual(statusesForListBucket("drafts"), ["draft"]);
  assert.ok(statusesForListBucket("sent")?.includes("delivered"));
  assert.equal(parseListBucket("nope"), "all");
  assert.equal(parseListBucket("failed"), "failed");
});
