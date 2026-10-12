import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  timeNotificationSendReads,
  writeMethods,
  type AudienceReads,
} from "./notification-dry-run";

describe("notification send dry run", () => {
  it("times audience and token reads and never calls a write or FCM", async () => {
    const writes = writeMethods();
    let writeCalls = 0;
    for (const name of Object.keys(writes) as Array<keyof typeof writes>) {
      const original = writes[name];
      writes[name] = () => {
        writeCalls += 1;
        return original();
      };
    }

    const db: AudienceReads = {
      async listLiveDriverIds() {
        return ["a", "b", "c"];
      },
      async listActiveTokenDriverIds() {
        return ["b", "missing", "a"];
      },
    };

    const timing = await timeNotificationSendReads(db);
    assert.equal(timing.audienceCount, 3);
    assert.equal(timing.tokenCount, 2);
    assert.equal(writeCalls, 0);
    assert.ok(timing.audienceMs >= 0);
    assert.ok(timing.tokenMs >= 0);
  });

  it("throws if a write or sendEach is touched", () => {
    const writes = writeMethods();
    for (const name of Object.keys(writes) as Array<keyof typeof writes>) {
      assert.throws(() => writes[name](), new RegExp(`dry_run_write:${name}`));
    }
  });
});
