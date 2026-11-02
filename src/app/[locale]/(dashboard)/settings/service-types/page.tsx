import { setRequestLocale } from "next-intl/server";
import { ServiceTypesPanel } from "@/features/fleet/service/service-types-panel";
import { listServiceTypes, listServiceTypeUsage } from "@/features/fleet/service/service-reads";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ServiceTypesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "service.manage");

  const [types, usage] = await Promise.all([listServiceTypes(), listServiceTypeUsage()]);
  return <ServiceTypesPanel types={types} usage={usage} />;
}
