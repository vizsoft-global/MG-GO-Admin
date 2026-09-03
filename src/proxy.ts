import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";
import { guardedRead, MIDDLEWARE_QUERY_BUDGET_MS } from "@/lib/supabase/deadline";
import {
  cacheOpsSettings,
  readCachedOpsSettings,
  type ProxyOpsSettings,
} from "@/lib/supabase/ops-settings-cache";

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

const PROFILE_SELECT =
  "approval_status, admin_role_id, archived_at, role, admin_roles(is_super_admin)";

type ProfileRow = {
  approval_status?: string;
  admin_role_id?: string | null;
  archived_at?: string | null;
  role?: string;
  admin_roles?: { is_super_admin: boolean } | null;
} | null;

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
  const { response, supabase, probe } = await updateSession(request, intlResponse);
  const { pathname } = request.nextUrl;
  const locale = getLocale(pathname);
  const path = pathWithoutLocale(pathname);

  if (path.startsWith("/api/")) {
    return response;
  }

  if (!supabase) {
    return response;
  }

  // The session is unproven rather than absent, so every branch below would be
  // deciding on a fact we do not have. Signing the admin out here is the one
  // outcome that is certainly wrong; the page still runs its own auth gate.
  if (probe.unavailable) {
    return response;
  }

  const { user } = probe;
  const protectedPath = isProtectedPath(pathname);

  if (!user) {
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
      : guardedRead<ProxyOpsSettings>(
          supabase
            .from("app_settings")
            .select("super_admin_claimed, maintenance_mode")
            .eq("id", 1)
            .maybeSingle(),
          MIDDLEWARE_QUERY_BUDGET_MS,
        ),
    wantsProfile
      ? guardedRead<NonNullable<ProfileRow>>(
          supabase.from("profiles").select(PROFILE_SELECT).eq("id", user.id).maybeSingle(),
          MIDDLEWARE_QUERY_BUDGET_MS,
        )
      : Promise.resolve({ data: null, failed: false as const }),
  ]);

  if (!cachedOps && !opsResult.failed) {
    cacheOpsSettings(opsResult.data);
  }

  const opsSettings = opsResult.data;
  const profileRow = profileResult.data as ProfileRow;

  // A read that failed proves nothing about the caller. Every branch below is
  // skipped in that case so the request falls through to the page, which runs
  // its own auth gate against a fresh client — the same reasoning the probe
  // above uses, applied to the profile it could not load.
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

    const isSuperAdmin = profileRow.admin_roles?.is_super_admin === true;

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
