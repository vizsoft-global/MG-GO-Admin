import assert from "node:assert/strict";
import { test } from "node:test";
import { userFromLocalJwt } from "./local-session";

const now = Date.UTC(2026, 8, 8, 6, 30, 0);

test("local JWT is used only when a user id is present and unexpired", () => {
  assert.equal(userFromLocalJwt(null, now), null);
  assert.equal(userFromLocalJwt({ user: null, expires_at: now / 1000 + 60 }, now), null);
  assert.equal(
    userFromLocalJwt({ user: { id: "u1" }, expires_at: now / 1000 - 1 }, now),
    null,
  );
  assert.deepEqual(
    userFromLocalJwt({ user: { id: "u1" }, expires_at: now / 1000 + 60 }, now),
    { id: "u1" },
  );
  assert.deepEqual(userFromLocalJwt({ user: { id: "u1" } }, now), { id: "u1" });
});
