import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { visibleApps } from "@/lib/menu/app-scope";
import { AppLauncherShell } from "@/features/launcher/app-launcher-shell";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "dashboard.view");
  const apps = visibleApps(session.permissions, session.isSuperAdmin).map((app) => ({
    id: app.id,
    href: app.href,
    icon: app.icon,
  }));
  return <AppLauncherShell apps={apps} />;
}
