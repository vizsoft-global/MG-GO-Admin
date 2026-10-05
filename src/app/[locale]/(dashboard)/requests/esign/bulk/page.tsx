import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignBulkShell } from "@/features/esign/esign-bulk-shell";

export default async function EsignBulkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  const { draft } = await searchParams;
  return <EsignBulkShell initialDraftId={draft} />;
}
