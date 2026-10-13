import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateStaffSession } from "@/lib/firebase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

const protectedPrefixes = [
  "/dashboard",
  "/drivers",
  "/deliveries",
  "/vehicles",
  "/attendance",
  "/driver-shifts",
  "/worktime",
  "/live-tracking",
  "/requests",
  "/wrong-actions",
  "/earnings",
  "/delivery-rules",
  "/incentive-rules",
  "/earnings-calculation",
  "/restaurants",
  "/partners",
  "/zones",
  "/notifications",
  "/support",
  "/settings",
];

function pathWithoutLocale(pathname: string): string {
  return pathname.replace(/^\/(en|ar)/, "") || "/";
}

function getLocale(pathname: string): string {
  const seg = pathname.split("/")[1];
  return seg === "en" || seg === "ar" ? seg : routing.defaultLocale;
}

function isProtectedPath(pathname: string): boolean {
  const path = pathWithoutLocale(pathname);
  return protectedPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const intlResponse = intlMiddleware(request);
  const { response, probe } = await updateStaffSession(request, intlResponse);
  const { pathname } = request.nextUrl;
  const locale = getLocale(pathname);
  const path = pathWithoutLocale(pathname);

  if (path.startsWith("/api/")) {
    return response;
  }

  // The session is unproven rather than absent. Signing the admin out here is
  // the one outcome that is certainly wrong; the page still runs its own gate.
  if (probe.unavailable) {
    return response;
  }

  // Cookie signature only. Profile, epochs, approval, maintenance, and the
  // unclaimed-super-admin redirect run once in requireAuth (and the setup
  // layout for the claim page itself).
  if (!probe.uid && isProtectedPath(pathname)) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|api|auth|monitoring|.*\\..*).*)"],
};
