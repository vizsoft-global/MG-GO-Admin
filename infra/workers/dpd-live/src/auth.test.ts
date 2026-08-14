import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signAdminToken, verifyAdminToken } from "./auth";
import { signFleetToken } from "../../../../src/features/live-tracking-v2/fleet-token";

const SECRET = "test-secret-do-not-use";
const NOW = Date.UTC(2026, 7, 14, 9, 0, 0);

describe("admin socket token", () => {
  it("round-trips", async () => {
    const token = await signAdminToken(SECRET, {
      sub: "admin-1",
      room: "fleet-kw",
      exp: Math.floor(NOW / 1000) + 60,
    });
    const payload = await verifyAdminToken(SECRET, token, NOW);
    assert.equal(payload?.sub, "admin-1");
    assert.equal(payload?.room, "fleet-kw");
  });

  it("is byte-identical to the admin app's signer", async () => {
    // The whole scheme rests on these two implementations agreeing. This test is the
    // only thing that would catch a base64url or JSON-shape drift between the app
    // route and the Worker, since they live in different builds and are never
    // deployed together.
    const payload = { sub: "admin-1", room: "fleet-kw", exp: 1_700_000_060 };
    assert.equal(
      await signAdminToken(SECRET, payload),
      await signFleetToken(SECRET, payload),
    );
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAdminToken("other-secret", {
      sub: "admin-1",
      room: "fleet-kw",
      exp: Math.floor(NOW / 1000) + 60,
    });
    assert.equal(await verifyAdminToken(SECRET, token, NOW), null);
  });

  it("rejects an expired token", async () => {
    const token = await signAdminToken(SECRET, {
      sub: "admin-1",
      room: "fleet-kw",
      exp: Math.floor(NOW / 1000) - 1,
    });
    assert.equal(await verifyAdminToken(SECRET, token, NOW), null);
  });

  it("rejects a tampered payload", async () => {
    const token = await signAdminToken(SECRET, {
      sub: "admin-1",
      room: "fleet-kw",
      exp: Math.floor(NOW / 1000) + 60,
    });
    const [, signature] = token.split(".");
    const forged = `${btoa('{"sub":"admin-1","room":"fleet-kw","exp":9999999999}')
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${signature}`;
    assert.equal(await verifyAdminToken(SECRET, forged, NOW), null);
  });

  it("rejects a malformed token instead of throwing", async () => {
    assert.equal(await verifyAdminToken(SECRET, "", NOW), null);
    assert.equal(await verifyAdminToken(SECRET, "nodot", NOW), null);
  });
});
