import { setRequestLocale } from "next-intl/server";
import { EsignBatchesShell } from "@/features/esign/esign-batches-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * EmployeeDesk V2's sent-batches list.
 *
 * Same `EsignBatchesShell` as `/requests/esign/batches`. The V2 route only
 * changes the home (Outgoing) and the permission door — send already uses
 * `requireAnyPermission` for `employeedesk.manage` or `requests.manage`.
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
