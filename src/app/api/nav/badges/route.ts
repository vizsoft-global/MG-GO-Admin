import { NextResponse } from "next/server";
import { fetchRequestTypeCounts } from "@/features/requests/requests-actions";
import { fetchPendingVerificationCount } from "@/features/verifications/verifications-actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The sidebar's badge counts, as a plain GET.
 *
 * They used to be server actions. Next sends one tab's server actions one at a
 * time, and the sidebar mounts before the page, so on every page these two went
 * first and the page's own data waited behind them. A `fetch` to this route is
 * outside that queue. Each function below checks the caller's session and
 * permission itself, exactly as it did when it was called as an action.
 */
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  try {
    if (kind === "requests") {
      return NextResponse.json(await fetchRequestTypeCounts(), { headers: NO_STORE });
    }
    if (kind === "verifications") {
      return NextResponse.json({ count: await fetchPendingVerificationCount() }, { headers: NO_STORE });
    }
    return NextResponse.json({ error: "unknown_kind" }, { status: 400, headers: NO_STORE });
  } catch {
    // A caller without the permission, or without a session: no counts, no detail.
    return NextResponse.json({ error: "unavailable" }, { status: 403, headers: NO_STORE });
  }
}
