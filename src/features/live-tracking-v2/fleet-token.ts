/**
 * Signing side of the admin socket token.
 *
 * The Cloudflare Worker cannot evaluate Postgres RLS, so it cannot decide who may
 * watch the fleet. The permission check happens here, in the app, and the verdict
 * travels to the edge as a short-lived HMAC assertion. Verification lives in
 * `infra/workers/dpd-live/src/auth.ts` and must stay byte-compatible with this file:
 * same payload key order is irrelevant, but the base64url encoding and the
 * `body.signature` shape are not.
 *
 * Web Crypto rather than `node:crypto` so the route can run on either runtime.
 */

export type FleetTokenPayload = {
  /** Admin user id — for Worker logs, never trusted for authorization. */
  sub: string;
  room: string;
  /** Unix seconds. */
  exp: number;
};

/**
 * 60 seconds. Long enough for a page load on a slow connection, short enough that a
 * token leaked into a proxy log or a screenshot is worthless by the time anyone
 * finds it. The socket, once open, outlives the token.
 */
export const FLEET_TOKEN_TTL_SECONDS = 60;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signFleetToken(
  secret: string,
  payload: FleetTokenPayload,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

export type FleetSocketTicket = {
  token: string;
  /** Absolute `wss://…/ws` endpoint, so the browser needs no edge env of its own. */
  wsUrl: string;
  room: string;
  /** Unix ms, for the client's refresh timer. */
  expiresAt: number;
};

export type FleetSocketTicketError = {
  error: "not_authorized" | "fleet_edge_not_configured";
};
