import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickLatestPushTokenByDriver } from "./push-token-select";

describe("pickLatestPushTokenByDriver", () => {
  it("keeps the most recently seen token when a driver has several active ones", () => {
    const picked = pickLatestPushTokenByDriver([
      {
        id: "old",
        driver_id: "d1",
        token: "kw-token",
        last_seen_at: "2026-08-11T03:55:37Z",
      },
      {
        id: "new",
        driver_id: "d1",
        token: "prod-token",
        last_seen_at: "2026-08-17T12:04:12Z",
      },
    ]);
    assert.equal(picked.get("d1")?.id, "new");
  });

  it("does not let query order replace a newer token with an older one", () => {
    const picked = pickLatestPushTokenByDriver([
      {
        id: "new",
        driver_id: "d1",
        token: "prod-token",
        last_seen_at: "2026-08-17T12:04:12Z",
      },
      {
        id: "old",
        driver_id: "d1",
        token: "kw-token",
        last_seen_at: "2026-08-11T03:55:37Z",
      },
    ]);
    assert.equal(picked.get("d1")?.token, "prod-token");
  });
});
