import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  FLEET_TOKEN_TTL_SECONDS,
  signFleetToken,
  type FleetSocketTicket,
} from "@/features/live-tracking-v2/fleet-token";

/**
 * Mints a 60-second ticket for the Live Tracking V2 edge socket.
 *
 * POST rather than GET because it is a credential issue, not a read: a GET would be
 * cacheable by any intermediary and prefetchable by the browser.
 */
export async function POST() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const secret = process.env.FLEET_WS_TOKEN_SECRET?.trim();
  const base = process.env.FLEET_WS_URL?.trim();
  const room = process.env.FLEET_ROOM?.trim() || "fleet-kw";

  // A missing edge is a normal deployment state, not a fault: the page falls back to
  // the Supabase mirror and then to snapshot polling. Returning 503 with a code lets
  // the client pick a rail instead of showing an error to an operator who cannot act
  // on it.
  if (!secret || !base) {
    return NextResponse.json(
      { error: "fleet_edge_not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const expSeconds = Math.floor(Date.now() / 1000) + FLEET_TOKEN_TTL_SECONDS;
  const token = await signFleetToken(secret, {
    sub: session.id,
    room,
    exp: expSeconds,
  });

  const ticket: FleetSocketTicket = {
    token,
    wsUrl: `${base.replace(/\/+$/, "")}/ws`,
    room,
    expiresAt: expSeconds * 1000,
  };

  return NextResponse.json(ticket, {
    headers: { "Cache-Control": "no-store" },
  });
}
