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
  "/compliance",
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

/**
 * Where the bare address goes: `/`, `/en` and `/ar` all end at the dashboard.
 *
 * They used to get there in two redirects, and the second one was a page: `/en`
 * rendered the whole root layout — the session read and every translated
 * message, 570 KB — only to answer "go to /en/dashboard". That was 0.7 to 3
 * seconds before the dashboard had even been asked for. The proxy now sends the
 * browser there in one step. For `/` the locale is the one next-intl chose
 * (cookie, then the browser's language), read from its own redirect.
 */
export function entryRedirectPath(pathname: string, intlLocation: string | null): string | null {
  const bare = pathname.replace(/\/+$/, "");
  if (bare === "/en" || bare === "/ar") return `${bare}/dashboard`;
  if (bare !== "") return null;
  let chosen: string = routing.defaultLocale;
  if (intlLocation) {
    try {
      const seg = new URL(intlLocation, "https://panel.invalid").pathname.split("/")[1];
      if (seg === "en" || seg === "ar") chosen = seg;
    } catch {
      // An unreadable Location keeps the default locale.
    }
  }
  return `/${chosen}/dashboard`;
}

export async function proxy(request: NextRequest) {
  const intlResponse = intlMiddleware(request);
  const entry = entryRedirectPath(request.nextUrl.pathname, intlResponse.headers.get("location"));
  if (entry) {
    return NextResponse.redirect(new URL(entry, request.url));
  }
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
