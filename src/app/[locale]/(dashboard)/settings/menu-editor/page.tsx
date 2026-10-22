import { setRequestLocale } from "next-intl/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { getAllAdminRoles } from "@/lib/auth/get-role-permissions";
import { MenuEditorPanel } from "@/features/menu-editor/menu-editor-panel";

export default async function MenuEditorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission(locale, "settings.manage");
  const roles = await getAllAdminRoles();

  return <MenuEditorPanel roles={roles} />;
}
