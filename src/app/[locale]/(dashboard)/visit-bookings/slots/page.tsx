import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/require-permission";
import { VisitsSlotsShell } from "@/features/visits/visits-slots-shell";

export default async function VisitBookingsSlotsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAuth(locale);
  const canCatalog = hasPermissionInSet(
    session.permissions,
    "visits.manage_catalog",
    session.isSuperAdmin,
  );
  if (canCatalog) return <VisitsSlotsShell />;
  if (hasPermissionInSet(session.permissions, "visits.view", session.isSuperAdmin)) {
    redirect({ href: "/visit-bookings", locale });
  }
  redirect({ href: "/unauthorized", locale });
}
