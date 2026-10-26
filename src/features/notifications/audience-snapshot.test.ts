import assert from "node:assert/strict";
import test from "node:test";
import { recipientIdsFromCompile } from "./audience-snapshot";

test("a snapshot id string is not treated as a recipient list", () => {
  assert.deepEqual(recipientIdsFromCompile("snap-1"), {
    snapshotId: "snap-1",
    recipientIds: null,
  });
});

test("an id list is the audience", () => {
  assert.deepEqual(recipientIdsFromCompile(["a", "b"]), {
    snapshotId: null,
    recipientIds: ["a", "b"],
  });
});

test("object and nested result shapes both yield ids", () => {
  assert.deepEqual(
    recipientIdsFromCompile({ snapshot_id: "snap-2", recipient_ids: ["d1"] }),
    { snapshotId: "snap-2", recipientIds: ["d1"] },
  );
  assert.deepEqual(recipientIdsFromCompile({ result: { id: "snap-3", recipientIds: ["d2"] } }), {
    snapshotId: "snap-3",
    recipientIds: ["d2"],
  });
});

test("an object stringified as an id is ignored", () => {
  assert.deepEqual(recipientIdsFromCompile("[object Object]"), {
    snapshotId: null,
    recipientIds: null,
  });
  assert.deepEqual(recipientIdsFromCompile({ id: "[object Object]", recipient_ids: ["d3"] }), {
    snapshotId: null,
    recipientIds: ["d3"],
  });
});
