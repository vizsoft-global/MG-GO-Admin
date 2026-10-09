import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import {
  readProxyOpsSettings,
  readProxyProfile,
  updateStaffSession,
  type ProxyOpsSettings,
} from "@/lib/firebase/middleware";
import {
  cacheOpsSettings,
  readCachedOpsSettings,
} from "@/lib/firebase/ops-settings-cache";

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

const publicAuthPaths = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/pending-approval",
  "/maintenance",
  "/setup/claim-super-admin",
  "/unauthorized",
]);

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

  // The session is unproven rather than absent, so every branch below would be
  // deciding on a fact we do not have. Signing the admin out here is the one
  // outcome that is certainly wrong; the page still runs its own auth gate.
  if (probe.unavailable) {
    return response;
  }

  const uid = probe.uid;
  const protectedPath = isProtectedPath(pathname);

  if (!uid) {
    if (protectedPath) {
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  const wantsProfile = protectedPath || path === "/login" || path === "/signup";
  const cachedOps = readCachedOpsSettings();

  const [opsResult, profileResult] = await Promise.all([
    cachedOps
      ? Promise.resolve({ data: cachedOps, failed: false as const })
      : readProxyOpsSettings(),
    wantsProfile
      ? readProxyProfile(uid)
      : Promise.resolve({ data: null, failed: false as const }),
  ]);

  if (!cachedOps && !opsResult.failed) {
    cacheOpsSettings(opsResult.data as ProxyOpsSettings | null);
  }

  const opsSettings = opsResult.data as ProxyOpsSettings | null;
  const profileRow = profileResult.data;

  // A read that failed proves nothing about the caller. Every branch below is
  // skipped in that case so the request falls through to the page, which runs
  // its own auth gate against a fresh read — the same reasoning the probe above
  // uses, applied to the profile it could not load.
  const profileUnknown = profileResult.failed;
  const superAdminClaimed = opsSettings?.super_admin_claimed ?? true;

  if (
    !superAdminClaimed &&
    path !== "/setup/claim-super-admin" &&
    !path.startsWith("/api")
  ) {
    const allowedBeforeClaim = new Set([
      "/signup",
      "/login",
      "/forgot-password",
      "/reset-password",
    ]);
    if (!allowedBeforeClaim.has(path)) {
      return NextResponse.redirect(
        new URL(`/${locale}/setup/claim-super-admin`, request.url),
      );
    }
  }

  if (protectedPath && !profileUnknown) {
    if (!superAdminClaimed) {
      return NextResponse.redirect(
        new URL(`/${locale}/setup/claim-super-admin`, request.url),
      );
    }

    if (profileRow?.approval_status === "pending") {
      return NextResponse.redirect(
        new URL(`/${locale}/pending-approval`, request.url),
      );
    }

    if (
      profileRow?.approval_status === "rejected" ||
      profileRow?.archived_at ||
      !profileRow?.admin_role_id
    ) {
      return NextResponse.redirect(
        new URL(`/${locale}/login?error=not_authorized`, request.url),
      );
    }

    // `is_super_admin` rides the custom claims, so the proxy no longer joins
    // admin_roles on every navigation.
    const isSuperAdmin = probe.claims?.superAdmin === true;

    if (opsSettings?.maintenance_mode && !isSuperAdmin) {
      return NextResponse.redirect(
        new URL(`/${locale}/maintenance`, request.url),
      );
    }
  }

  if (publicAuthPaths.has(path)) {
    if (path === "/setup/claim-super-admin") {
      if (superAdminClaimed) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
      }
      return response;
    }

    if (path === "/login" || path === "/signup") {
      if (profileRow?.approval_status === "pending") {
        return NextResponse.redirect(
          new URL(`/${locale}/pending-approval`, request.url),
        );
      }
      if (profileRow?.approval_status === "approved" && profileRow.admin_role_id) {
        return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|api|auth|monitoring|.*\\..*).*)"],
};
