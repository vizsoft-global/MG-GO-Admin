import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { EsignImportExportShell } from "@/features/esign/esign-import-export-shell";

export default async function RequestsImportExportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "requests.manage");
  return <EsignImportExportShell />;
}
