import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { EsignBatchDetailShell } from "@/features/esign/esign-batch-detail-shell";
import { requireAnyPermission } from "@/lib/auth/require-permission";

/**
 * EmployeeDesk V2's batch detail.
 *
 * Same `EsignBatchDetailShell` as `/requests/esign/batches/[id]`. The V2
 * route only changes the home and the permission door.
 */
export default async function EmployeeDeskEsignBatchDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAnyPermission(locale, ["employeedesk.manage", "requests.manage"]);
  return (
    <Suspense fallback={null}>
      <EsignBatchDetailShell batchId={id} />
    </Suspense>
  );
}
