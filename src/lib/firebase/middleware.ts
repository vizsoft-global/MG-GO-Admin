import { NextResponse, type NextRequest } from "next/server";
import {
  STAFF_SESSION_COOKIE,
  MIDDLEWARE_SESSION_BUDGET_MS,
  verifyStaffSessionCookie,
  type StaffProbe,
} from "@/lib/firebase/session";

export type StaffSessionContext = {
  response: NextResponse;
  probe: StaffProbe;
};

/**
 * Identifies the caller from the session cookie signature.
 * `checkRevoked` stays false. Profile, epoch, and approval live in requireAuth.
 */
export async function updateStaffSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next({ request }),
): Promise<StaffSessionContext> {
  const cookie = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
  const probe = await verifyStaffSessionCookie(cookie, {
    timeoutMs: MIDDLEWARE_SESSION_BUDGET_MS,
    checkRevoked: false,
  });
  return { response, probe };
}
