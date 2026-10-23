import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeSnapshotFlagsFrom } from "./settings";

describe("home snapshot flags", () => {
  it("stays off unless the setting is the boolean true", () => {
    assert.deepEqual(homeSnapshotFlagsFrom(undefined), { enabled: false, shadow: false });
    assert.deepEqual(homeSnapshotFlagsFrom({}), { enabled: false, shadow: false });
    assert.deepEqual(homeSnapshotFlagsFrom({ home_snapshot_enabled: "true" }), {
      enabled: false,
      shadow: false,
    });
    assert.deepEqual(
      homeSnapshotFlagsFrom({ home_snapshot_enabled: true, home_snapshot_shadow: true }),
      { enabled: true, shadow: true },
    );
  });
});
