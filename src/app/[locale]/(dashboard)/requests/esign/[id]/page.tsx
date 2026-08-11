import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignDetailPageShell } from "@/features/esign/esign-detail-page-shell";

export default async function EsignDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignDetailPageShell requestId={id} />;
}
