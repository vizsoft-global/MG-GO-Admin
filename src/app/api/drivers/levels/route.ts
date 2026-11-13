import { NextResponse } from "next/server";
import { listDriverLevels } from "@/features/drivers/driver-level-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "private, no-store" };

function count(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/**
 * The fleet's level index for the Employees page, as a plain GET.
 *
 * It is the slowest read on that page (the backend builds every rider's level
 * for the month before it answers). As a server action it sat in the tab's
 * action queue, so the list's own requests — the next page, a filter — waited
 * behind it. The backend checks the caller's permission, as it did for the action.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const result = await listDriverLevels({
      limit: count(params.get("limit"), 2000, 2000) || 2000,
      offset: count(params.get("offset"), 0, 100_000),
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ data: null, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
