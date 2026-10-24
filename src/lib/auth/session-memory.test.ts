import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRememberedSession,
  clearReadSessionMemory,
  cookieMemoryKey,
  recallReadSession,
  rememberReadSession,
} from "./session-memory";
import type { SessionUser } from "./get-session";

function fakeSession(id: string): SessionUser {
  return {
    id,
    email: `${id}@mghub.test`,
    profile: {
      id,
      approval_status: "approved",
      admin_role_id: "role-1",
    } as SessionUser["profile"],
    permissions: new Set(["order_recon.view"]),
    isSuperAdmin: false,
    isManager: false,
    accessKind: "manager",
    partnerProjectKey: null,
    adminRoleSlug: "administrator",
    epochs: { access: 1, settings: 1, menu: 1 },
  };
}

test("cookieMemoryKey is stable and not the raw cookie", () => {
  const a = cookieMemoryKey("cookie-a");
  assert.equal(a, cookieMemoryKey("cookie-a"));
  assert.notEqual(a, "cookie-a");
  assert.notEqual(a, cookieMemoryKey("cookie-b"));
});

test("remembered session clones the permission set", () => {
  clearReadSessionMemory();
  const session = fakeSession("u1");
  rememberReadSession("ck", session);
  session.permissions.add("hacked");
  const recalled = recallReadSession("ck");
  assert.ok(recalled);
  assert.equal(recalled.permissions.has("hacked"), false);
  assert.equal(recalled.permissions.has("order_recon.view"), true);
});

test("applyRememberedSession keeps a live session and a real logout", () => {
  const live = fakeSession("live");
  const remembered = fakeSession("mem");
  assert.equal(
    applyRememberedSession(
      { session: live, unavailable: true, notAuthorized: false },
      remembered,
    ).session?.id,
    "live",
  );
  assert.equal(
    applyRememberedSession(
      { session: null, unavailable: false, notAuthorized: false },
      remembered,
    ).session,
    null,
  );
  assert.equal(
    applyRememberedSession(
      { session: null, unavailable: false, notAuthorized: true },
      remembered,
    ).notAuthorized,
    true,
  );
});

test("applyRememberedSession restores an isolate-verified cookie on a timeout", () => {
  const remembered = fakeSession("mem");
  const restored = applyRememberedSession(
    { session: null, unavailable: true, notAuthorized: false },
    remembered,
  );
  assert.equal(restored.session?.id, "mem");
  assert.equal(restored.unavailable, false);
});
