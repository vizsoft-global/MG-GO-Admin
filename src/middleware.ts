import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

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

export async function middleware(request: NextRequest) {
  const intlResponse = intlMiddleware(request);
  const response = await updateSession(request, intlResponse);
  const { pathname } = request.nextUrl;
  const locale = getLocale(pathname);
  const path = pathWithoutLocale(pathname);

  if (path.startsWith("/api/")) {
    return response;
  }

  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  if (!url || !key) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const loginUrl = new URL(`/${locale}/login`, request.url);

  const { data: opsSettings } = await supabase
    .from("app_settings")
    .select("super_admin_claimed, maintenance_mode")
    .eq("id", 1)
    .maybeSingle();

  const superAdminClaimed = opsSettings?.super_admin_claimed ?? true;

  if (
    user &&
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

  if (isProtectedPath(pathname)) {
    if (!user) {
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "approval_status, admin_role_id, archived_at, role, admin_roles(is_super_admin)",
      )
      .eq("id", user.id)
      .maybeSingle();

    const profileRow = profile as {
      approval_status?: string;
      admin_role_id?: string | null;
      archived_at?: string | null;
      role?: string;
      admin_roles?: { is_super_admin: boolean } | null;
    } | null;

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

  if (user && publicAuthPaths.has(path)) {
    if (path === "/setup/claim-super-admin") {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("super_admin_claimed")
        .eq("id", 1)
        .maybeSingle();
      if (settings?.super_admin_claimed) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
      }
      return response;
    }

    if (path === "/login" || path === "/signup") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("approval_status, admin_role_id")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.approval_status === "pending") {
        return NextResponse.redirect(
          new URL(`/${locale}/pending-approval`, request.url),
        );
      }
      if (profile?.approval_status === "approved" && profile.admin_role_id) {
        return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next|api|auth|monitoring|.*\\..*).*)"],
};
