import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-permission";
import { getAppOpsSettings } from "@/lib/auth/app-settings";
import { redirect } from "@/i18n/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { SidebarMenuConfigProvider } from "@/contexts/sidebar-menu-context";
import { getMenuConfigServer } from "@/services/menu-config-server";
import { DashboardFrame } from "@/components/layout/dashboard-frame";
import { SentryUserSync } from "@/components/system/sentry-user-sync";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireAuth(locale);
  const [ops, menuConfig] = await Promise.all([
    getAppOpsSettings(),
    getMenuConfigServer(session.adminRoleSlug),
  ]);

  if (ops.maintenanceMode && !session.isSuperAdmin) {
    redirect({ href: "/maintenance", locale });
  }

  return (
    <AuthProvider
      value={{
        userId: session.id,
        email: session.email,
        fullName: session.profile.full_name,
        role: session.profile.role,
        locale: session.profile.locale,
        adminRoleId: session.profile.admin_role_id,
        approvalStatus: session.profile.approval_status,
        isSuperAdmin: session.isSuperAdmin,
        isManager: session.isManager,
        accessKind: session.accessKind,
        adminRoleSlug: session.adminRoleSlug,
        permissions: Array.from(session.permissions),
      }}
    >
      <SentryUserSync />
      <SidebarMenuConfigProvider config={menuConfig}>
        <DashboardFrame>{children}</DashboardFrame>
      </SidebarMenuConfigProvider>
    </AuthProvider>
  );
}
