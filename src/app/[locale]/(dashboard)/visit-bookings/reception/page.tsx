import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsReceptionShell } from "@/features/visits/visits-reception-shell";

export default async function VisitBookingsReceptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.operate");
  return <VisitsReceptionShell />;
}
