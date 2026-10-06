import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { redirect } from "@/i18n/navigation";

export default async function StaffAccessDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);
  redirect({ href: `/settings/roles?user=${id}`, locale });
}
