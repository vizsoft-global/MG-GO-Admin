import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readOnlyDb } from "./perf-readonly-db.mjs";

describe("read-only firestore facade", () => {
  it("allows get and throws on every write", async () => {
    const writes = [];
    const db = {
      collection() {
        return {
          where() {
            return this;
          },
          select() {
            return this;
          },
          get: async () => ({ size: 1, docs: [] }),
          doc() {
            return {
              set: () => {
                writes.push("set");
              },
            };
          },
          add: () => {
            writes.push("add");
          },
        };
      },
      runTransaction: () => {
        writes.push("runTransaction");
      },
      bulkWriter: () => {
        writes.push("bulkWriter");
      },
    };

    const safe = readOnlyDb(db);
    const snap = await safe.collection("drivers").where("archived_at", "==", null).select("is_blocked").get();
    assert.equal(snap.size, 1);
    for (const name of ["set", "update", "create", "delete", "add", "commit", "runTransaction", "bulkWriter", "sendEach"]) {
      assert.throws(() => safe[name](), /dry_run_write:/);
    }
    assert.throws(() => safe.collection("drivers").add(), /dry_run_write:add/);
    assert.throws(() => safe.collection("drivers").doc("x").set(), /dry_run_write:set/);
    assert.equal(writes.length, 0);
  });
});
