import { NextResponse } from "next/server";
import { fetchDriversPage, type DriversPageQuery } from "@/features/drivers/drivers-list-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "private, no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One page of the Employees list.
 *
 * It is a POST so the search text and filters travel in the body, not in the
 * address. It is a route and not a server action because Next sends one tab's
 * server actions one at a time: the page fires eight small ones on mount
 * (custom fields, statuses, sections, vehicle types …) and the list was ninth,
 * so the riders the operator is waiting for did not start loading for about
 * five seconds. A fetch is outside that queue and starts at once.
 *
 * `fetchDriversPage` checks the session and `drivers.view` itself and clamps
 * the limit; the backend validates the tab, sort and filters.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  if (!isRecord(body) || !isRecord(body.query) || !isRecord(body.query.filters) || !isRecord(body.query.sort)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  const offset = Number(body.offset);
  const limit = Number(body.limit);
  try {
    const page = await fetchDriversPage(
      body.query as DriversPageQuery,
      Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100,
    );
    return NextResponse.json(page, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]{3,40}$/.test(error.message) ? error.message : "failed";
    return NextResponse.json(
      { error: code },
      { status: code === "not_authorized" ? 403 : 500, headers: NO_STORE },
    );
  }
}
