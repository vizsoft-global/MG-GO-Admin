import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignReportsShell } from "@/features/esign/esign-reports-shell";

export default async function RequestsReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.view");
  return <EsignReportsShell />;
}
