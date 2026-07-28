import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { PartnersPageShell } from "@/features/partners/partners-page-shell";

export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "partners.view");

  return <PartnersPageShell />;
}
