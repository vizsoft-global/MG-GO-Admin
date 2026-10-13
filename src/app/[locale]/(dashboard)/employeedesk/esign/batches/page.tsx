import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { EsignBatchesShell } from "@/features/esign/esign-batches-shell";

/**
 * The `/employeedesk` twin of `/requests/esign/batches`.
 * Same shell. A bookmark on either URL is the tracker.
 */
export default async function EmployeeDeskEsignBatchesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return <EsignBatchesShell />;
}
