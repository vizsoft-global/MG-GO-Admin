import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AuthProvider } from "@/contexts/auth-context";
import { SidebarEpochsProvider } from "@/contexts/sidebar-epochs-context";
import { SidebarMenuConfigProvider } from "@/contexts/sidebar-menu-context";
import { AppLauncherShell } from "@/features/launcher/app-launcher-shell";
import type { MenuNode } from "@/services/menu-config-service";

export const dynamic = "force-dynamic";

const PREVIEW_MENU: MenuNode[] = [];

export default async function PreviewLauncherPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <AuthProvider
      value={{
        userId: "preview-user",
        email: "preview@mghub.local",
        fullName: "Preview Admin",
        role: "staff",
        locale,
        adminRoleId: "preview-role",
        approvalStatus: "approved",
        isSuperAdmin: true,
        isManager: true,
        accessKind: "manager",
        partnerProjectKey: null,
        adminRoleSlug: "super_admin",
        permissions: [],
      }}
    >
      <SidebarEpochsProvider access={0} menu={0}>
        <SidebarMenuConfigProvider config={PREVIEW_MENU}>
          <AppLauncherShell />
        </SidebarMenuConfigProvider>
      </SidebarEpochsProvider>
    </AuthProvider>
  );
}
