import { setRequestLocale } from "next-intl/server";
import { requireAnyPermission } from "@/lib/auth/require-permission";
import { EsignBatchDetailShell } from "@/features/esign/esign-batch-detail-shell";

export default async function EmployeeDeskEsignBatchDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return <EsignBatchDetailShell batchId={id} />;
}
