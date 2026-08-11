import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsSlotsShell } from "@/features/visits/visits-slots-shell";

export default async function VisitBookingsSlotsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.manage_catalog");
  return <VisitsSlotsShell />;
}
