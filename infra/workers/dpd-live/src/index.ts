/**
 * dpd-live — edge entry point.
 *
 * Stateless: every request is forwarded to the FleetRoom Durable Object addressed by
 * `FLEET_ROOM`. The Worker's own job is CORS, routing and nothing else, so that
 * authority over fleet state lives in exactly one place.
 */

import type { Env } from "./env";
import { FleetRoom } from "./fleet-room";

export { FleetRoom };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return withCors(
        new Response(JSON.stringify({ ok: true, room: env.FLEET_ROOM }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    const room = env.FLEET.get(env.FLEET.idFromName(env.FLEET_ROOM));

    if (url.pathname === "/ws") {
      // Upgrades cannot carry CORS headers or a body; the token is in the query
      // string because browsers cannot set headers on a WebSocket handshake.
      return room.fetch(request);
    }

    if (url.pathname === "/ingest" && request.method === "POST") {
      return withCors(await room.fetch(request));
    }

    if (
      (url.pathname === "/refresh" || url.pathname === "/stats") &&
      request.headers.get("x-fleet-admin-key") === env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return withCors(await room.fetch(request));
    }

    return withCors(
      new Response(JSON.stringify({ ok: false, error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  },
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
