import { setRequestLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { DriverFieldsSettingsPanel } from "@/features/custom-fields/driver-fields-settings-panel";

/**
 * Custom columns and slicers.
 *
 * **Super Admin only**, per 5.2 of the client review: a definition adds a column
 * every staff member reads and a slicer they all filter by, so it is shared
 * configuration rather than a personal view. The per-user Columns picker on each
 * list is untouched — that stays a personal preference.
 */
export default async function DriverFieldsSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireSuperAdmin(locale);

  return <DriverFieldsSettingsPanel />;
}
