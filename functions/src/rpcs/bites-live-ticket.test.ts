import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  FLEET_TICKET_TTL_SECONDS,
  base64Url,
  fleetTicketFor,
  signFleetTicket,
} from "./bites-live-ticket";

const SECRET = "s3cret";

/** Mirrors `verifyAdminToken` in infra/workers/dpd-live/src/auth.ts. */
function verify(secret: string, token: string, nowSeconds: number) {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = base64Url(createHmac("sha256", secret).update(body).digest());
  if (expected !== signature) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    sub: string;
    room: string;
    exp: number;
  };
  if (!payload.exp || payload.exp < nowSeconds) return null;
  return payload;
}

describe("signFleetTicket", () => {
  it("produces a body.signature the Worker accepts", () => {
    const payload = { sub: "bites-admin", room: "fleet-kw", exp: 1_800_000_000 };
    const token = signFleetTicket(SECRET, payload);

    assert.deepEqual(verify(SECRET, token, 1_700_000_000), payload);
    // A different secret must not verify: this is the only thing gating the socket.
    assert.equal(verify("other", token, 1_700_000_000), null);
  });

  it("uses base64url without padding, which the Worker's decoder requires", () => {
    const payload = { sub: "s", room: "fleet-kw", exp: 1_800_000_000 };
    const token = signFleetTicket(SECRET, payload);
    assert.equal(/[+/=]/.test(token), false);
  });

  it("expires", () => {
    const token = signFleetTicket(SECRET, { sub: "s", room: "fleet-kw", exp: 1_000 });
    assert.equal(verify(SECRET, token, 1_001)?.exp, undefined);
  });
});

describe("fleetTicketFor", () => {
  it("returns one minute of validity and an absolute wss endpoint", () => {
    const now = new Date("2026-10-16T09:30:00.000Z");
    const ticket = fleetTicketFor({
      secret: SECRET,
      baseUrl: "https://dpd-live.vizsoft.workers.dev/",
      room: "fleet-kw",
      sub: "bites-admin",
      now,
    });

    assert.equal(ticket.wsUrl, "https://dpd-live.vizsoft.workers.dev/ws");
    assert.equal(ticket.room, "fleet-kw");
    assert.equal(
      ticket.expiresAt,
      Math.floor(now.getTime() / 1000) * 1000 + FLEET_TICKET_TTL_SECONDS * 1000,
    );
    assert.equal(
      verify(SECRET, ticket.token, Math.floor(now.getTime() / 1000))?.room,
      "fleet-kw",
    );
  });
});
