import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AccidentForm } from "@/features/fleet/accidents/accident-form";
import { getAccident } from "@/features/fleet/accidents/accident-reads";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function EditAccidentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "vehicles.manage");
  const canManage = hasPermissionInSet(
    session.permissions,
    "vehicles.manage",
    session.isSuperAdmin,
  );

  const accident = await getAccident(id);
  if (!accident) notFound();

  return <AccidentForm accident={accident} canManage={canManage} />;
}
