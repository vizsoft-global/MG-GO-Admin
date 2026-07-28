import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { ZoneFormPage } from "@/features/zones/zone-form-page";

export default async function NewZonePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "zones.manage");

  return <ZoneFormPage />;
}
