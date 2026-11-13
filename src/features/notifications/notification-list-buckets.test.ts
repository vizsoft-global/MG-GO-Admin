import assert from "node:assert/strict";
import test from "node:test";
import { parseListBucket, statusInListBucket, statusesForListBucket } from "./notification-list-buckets";

test("sent and drafts are status groups, all is unfiltered", () => {
  assert.equal(statusesForListBucket("all"), null);
  assert.deepEqual(statusesForListBucket("drafts"), ["draft"]);
  assert.ok(statusesForListBucket("sent")?.includes("delivered"));
  assert.equal(parseListBucket("nope"), "all");
  assert.equal(parseListBucket("failed"), "failed");
});

test("a row only belongs to the bucket its status is listed in", () => {
  assert.equal(statusInListBucket("drafts", "draft"), true);
  assert.equal(statusInListBucket("drafts", "sent"), false);
  assert.equal(statusInListBucket("drafts", "delivered"), false);
  assert.equal(statusInListBucket("sent", "delivered"), true);
  assert.equal(statusInListBucket("sent", "draft"), false);
  assert.equal(statusInListBucket("scheduled", "queued"), true);
  assert.equal(statusInListBucket("failed", "cancelled"), true);
  assert.equal(statusInListBucket("failed", "sent"), false);
});

test("all keeps every row and an unknown status never matches a bucket", () => {
  assert.equal(statusInListBucket("all", "draft"), true);
  assert.equal(statusInListBucket("all", null), true);
  assert.equal(statusInListBucket("drafts", null), false);
  assert.equal(statusInListBucket("drafts", ""), false);
});
