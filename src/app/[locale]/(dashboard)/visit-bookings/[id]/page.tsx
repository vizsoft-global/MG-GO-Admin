import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitDetailPageShell } from "@/features/visits/visit-detail-page-shell";

export default async function VisitBookingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.view");
  return <VisitDetailPageShell bookingId={id} />;
}
