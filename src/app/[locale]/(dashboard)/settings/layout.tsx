import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireNotPartner, requireSettingsAccess } from "@/lib/auth/require-permission";

/**
 * Secondary nav for settings sub-pages is handled by AppSecondaryNav in the dashboard layout.
 *
 * The app-level Settings area is blocked for a partner login and for a plain `user`
 * staff account; a manager and a super admin keep it. One layout guards every
 * `/settings/*` route — the catalogue editors, Roles & Permissions, Driver App,
 * Storage, Maintenance, Languages, the activity log and the profile page — so the
 * block holds even when someone types the URL. The per-page `requirePermission`
 * calls stay as the narrower second check.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireNotPartner(locale);
  await requireSettingsAccess(locale);
  return <>{children}</>;
}
