import { NextResponse } from "next/server";
import { listDriverImportJobs } from "@/features/drivers/drivers-import-job-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The bulk-import job list the banner polls, as a plain GET, so it does not sit
 * in the server-action queue ahead of the page's own data on every page load.
 * `listDriverImportJobs` checks the session and `drivers.manage` itself.
 */
export async function GET() {
  try {
    const result = await listDriverImportJobs();
    return NextResponse.json(result, { status: "error" in result ? 403 : 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
