import type { ReactNode } from "react";
import { redirect } from "@/i18n/navigation";
import { getAppOpsSettings } from "@/lib/auth/app-settings";

/**
 * The claim page is outside the dashboard layout, so this is the read that
 * sends a visitor away once `super_admin_claimed` is true. An unproven read
 * does not force the page closed: `unclaimedSuperAdmin` is false on failure,
 * which matches the old proxy (`?? true` treated a missing row as claimed).
 */
export default async function SetupLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ops = await getAppOpsSettings();
  if (!ops.unclaimedSuperAdmin) {
    redirect({ href: "/login", locale });
  }
  return children;
}
