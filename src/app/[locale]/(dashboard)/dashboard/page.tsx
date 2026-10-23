import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth/get-session";
import { requirePermission } from "@/lib/auth/require-permission";
import { AppLauncherShell } from "@/features/launcher/app-launcher-shell";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionUser();
  if (session?.accessKind === "partner") {
    redirect({ href: "/client-portal", locale });
  }
  await requirePermission(locale, "dashboard.view");
  return <AppLauncherShell />;
}
