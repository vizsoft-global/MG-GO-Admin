import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { SourceCompaniesPanel } from "@/features/drivers/source-companies-panel";
import { listSourceCompaniesWithUsage } from "@/features/drivers/source-companies-actions";

export default async function SourceCompaniesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");

  const companies = await listSourceCompaniesWithUsage();
  return <SourceCompaniesPanel companies={companies} />;
}
