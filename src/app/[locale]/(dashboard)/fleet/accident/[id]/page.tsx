import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AccidentDetail } from "@/features/fleet/accidents/accident-detail";
import { getAccident } from "@/features/fleet/accidents/accident-reads";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function AccidentDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "vehicles.view");
  const canManage = hasPermissionInSet(
    session.permissions,
    "vehicles.manage",
    session.isSuperAdmin,
  );

  const accident = await getAccident(id);
  if (!accident) notFound();

  return <AccidentDetail accident={accident} canManage={canManage} />;
}
