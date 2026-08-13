import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { VisitsBranchesShell } from "@/features/visits/visits-branches-shell";

export default async function VisitBookingsBranchesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "visits.manage_catalog");
  return <VisitsBranchesShell />;
}
