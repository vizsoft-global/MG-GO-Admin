import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsReportsPanel } from "@/features/requests/requests-reports-panel";

export default async function RequestsReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <RequestsReportsPanel />;
}
