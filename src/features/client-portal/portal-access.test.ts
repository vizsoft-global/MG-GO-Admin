import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePortalProject, type PortalAccessSession } from "./portal-access";

const partner = (partnerProjectKey: string | null): PortalAccessSession => ({
  accessKind: "partner",
  isSuperAdmin: false,
  partnerProjectKey,
});

describe("resolvePortalProject", () => {
  it("ignores a project a partner sends", () => {
    assert.deepEqual(resolvePortalProject(partner("keeta"), "americana"), { projectKey: "keeta" });
  });

  it("refuses a partner with no project", () => {
    assert.deepEqual(resolvePortalProject(partner(null), "keeta"), { error: "denied" });
  });

  it("lets a super admin pick a known project", () => {
    const session: PortalAccessSession = { accessKind: "manager", isSuperAdmin: true, partnerProjectKey: null };
    assert.deepEqual(resolvePortalProject(session, "americana"), { projectKey: "americana" });
  });

  it("falls back to keeta for a super admin when the key is unknown", () => {
    const session: PortalAccessSession = { accessKind: "manager", isSuperAdmin: true, partnerProjectKey: null };
    assert.deepEqual(resolvePortalProject(session, "talabat"), { projectKey: "keeta" });
  });

  it("refuses staff who are not a super admin", () => {
    const session: PortalAccessSession = { accessKind: "user", isSuperAdmin: false, partnerProjectKey: null };
    assert.deepEqual(resolvePortalProject(session, "keeta"), { error: "denied" });
  });
});
