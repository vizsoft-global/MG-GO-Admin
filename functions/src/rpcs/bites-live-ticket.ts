/**
 * Fleet socket tickets for the Bites admin panel.
 *
 * The dpd-live Worker accepts an admin socket only with an HMAC assertion signed by
 * `ADMIN_WS_TOKEN_SECRET` (`infra/workers/dpd-live/src/auth.ts`). That secret must
 * never reach a browser, and the DPD Next.js route that mints tickets is behind a
 * DPD staff session, which a Bites admin does not have.
 *
 * So the DPD side serves the same ticket over HTTP, gated by a shared secret held
 * only by the Bites Cloud Functions. The Bites callable `bitesFleetSocketTicket`
 * verifies the Bites admin's own ID token and then calls this endpoint, which means
 * the secret stays server-to-server and the edge still sees a short-lived assertion
 * rather than a permanent key.
 */
import "../core/init";
import { createHmac, timingSafeEqual } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

/**
 * Shared with the Bites callable. `x-bites-bridge-secret` is compared in constant
 * time, the same shape `fleet-worker-http.ts` uses for the Worker.
 */
export const bitesBridgeSecret = defineSecret("BITES_BRIDGE_SECRET");

/** Must hold the same value as the Worker's `ADMIN_WS_TOKEN_SECRET`. */
export const adminWsTokenSecret = defineSecret("ADMIN_WS_TOKEN_SECRET");

const DEFAULT_ROOM = "fleet-kw";
const DEFAULT_WS_URL = "https://dpd-live.vizsoft.workers.dev";

/**
 * Matches `FLEET_TOKEN_TTL_SECONDS` on the DPD admin route: long enough for a cold
 * page load, short enough that a leaked ticket is worthless. An open socket outlives
 * its ticket.
 */
export const FLEET_TICKET_TTL_SECONDS = 60;

export type FleetTicket = {
  token: string;
  wsUrl: string;
  room: string;
  expiresAt: number;
};

/** base64url, matching `btoa`-then-replace in the Worker's signer. */
export function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * `body.base64url(hmac-sha256(body))`.
 *
 * Node's HMAC rather than Web Crypto because this runs in Cloud Functions; the
 * Worker only re-serialises the body it received and verifies the signature, so the
 * JSON key order here is not part of the contract.
 */
export function signFleetTicket(
  secret: string,
  payload: { sub: string; room: string; exp: number },
): string {
  const body = base64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = createHmac("sha256", secret).update(body).digest();
  return `${body}.${base64Url(signature)}`;
}

export function fleetTicketFor(options: {
  secret: string;
  baseUrl: string;
  room: string;
  sub: string;
  now?: Date;
  ttlSeconds?: number;
}): FleetTicket {
  const now = options.now ?? new Date();
  const ttl = options.ttlSeconds ?? FLEET_TICKET_TTL_SECONDS;
  const exp = Math.floor(now.getTime() / 1000) + ttl;
  return {
    token: signFleetTicket(options.secret, { sub: options.sub, room: options.room, exp }),
    wsUrl: `${options.baseUrl.replace(/\/+$/, "")}/ws`,
    room: options.room,
    expiresAt: exp * 1000,
  };
}

function secretValue(secret: { value: () => string }): string {
  try {
    return secret.value() ?? "";
  } catch {
    return "";
  }
}

function authorized(header: string | undefined, expected: string): boolean {
  if (!expected || !header) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function envValue(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value !== "" ? value : fallback;
}

export const bitesFleetSocketTicket = onRequest(
  { secrets: [bitesBridgeSecret, adminWsTokenSecret], invoker: "public", timeoutSeconds: 30 },
  (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }
    if (!authorized(req.header("x-bites-bridge-secret"), secretValue(bitesBridgeSecret))) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const secret = secretValue(adminWsTokenSecret);
    if (!secret) {
      // A missing edge secret is a deployment state, not a client error: the panel
      // falls back to its snapshot rail instead of showing an operator a failure
      // they cannot act on.
      logger.warn("bitesFleetSocketTicket: ADMIN_WS_TOKEN_SECRET is not set");
      res.status(503).json({ ok: false, error: "fleet_edge_not_configured" });
      return;
    }

    const payload = (req.body ?? {}) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" && payload.sub.trim() !== "" ? payload.sub.trim() : "bites-admin";

    res.status(200).json({
      ok: true,
      ...fleetTicketFor({
        secret,
        baseUrl: envValue("FLEET_WS_URL", DEFAULT_WS_URL),
        room: envValue("FLEET_ROOM", DEFAULT_ROOM),
        sub,
      }),
    });
  },
);
