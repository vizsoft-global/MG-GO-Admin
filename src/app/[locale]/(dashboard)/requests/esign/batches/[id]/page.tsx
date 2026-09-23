import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignBatchDetailShell } from "@/features/esign/esign-batch-detail-shell";

export default async function EsignBatchDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignBatchDetailShell batchId={id} />;
}
