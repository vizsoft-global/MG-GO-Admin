import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ServiceRecordDetail } from "@/features/fleet/service/service-record-detail";
import { ServiceRecordForm } from "@/features/fleet/service/service-record-form";
import { getServiceRecord } from "@/features/fleet/service/service-reads";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/require-permission";

export default async function ServiceRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { locale, id } = await params;
  const { edit } = await searchParams;
  setRequestLocale(locale);
  const session = await requirePermission(locale, "service.view");
  const canManage = hasPermissionInSet(
    session.permissions,
    "service.manage",
    session.isSuperAdmin,
  );

  const record = await getServiceRecord(id);
  if (!record) notFound();

  if (edit === "1" && canManage) {
    return <ServiceRecordForm record={record} />;
  }
  return <ServiceRecordDetail record={record} canManage={canManage} />;
}
