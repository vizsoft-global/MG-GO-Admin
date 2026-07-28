import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ZoneFormPage } from "@/features/zones/zone-form-page";

export default async function EditZonePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "zones.manage");

  return <ZoneFormPage zoneId={id} />;
}
