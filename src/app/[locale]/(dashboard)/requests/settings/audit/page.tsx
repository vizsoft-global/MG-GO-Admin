import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { RequestsAuditPanel } from "@/features/requests/requests-audit-panel";

export default async function RequestsAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");

  return <RequestsAuditPanel />;
}
