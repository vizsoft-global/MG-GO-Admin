import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { logAdminPageView } from "@/lib/audit/log-admin-activity";
import { VerificationsPageShell } from "@/features/verifications/verifications-page-shell";

export default async function DpdVerificationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "verifications.view");
  void logAdminPageView("/dpd-verification", "DpdVerificationPage");

  return <VerificationsPageShell />;
}
