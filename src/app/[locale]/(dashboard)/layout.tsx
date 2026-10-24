import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { resolvePanelAuth } from "@/lib/auth/require-permission";
import { getAppOpsSettings } from "@/lib/auth/app-settings";
import { redirect } from "@/i18n/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { SidebarEpochsProvider } from "@/contexts/sidebar-epochs-context";
import { SidebarMenuConfigProvider } from "@/contexts/sidebar-menu-context";
import { getMenuConfigServer } from "@/services/menu-config-server";
import { DashboardFrame } from "@/components/layout/dashboard-frame";
import {
  ClearLocaleErrorRetries,
  SessionRecover,
} from "@/components/system/session-recover";
import { SentryUserSync } from "@/components/system/sentry-user-sync";

export const maxDuration = 300;

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const opsPromise = getAppOpsSettings();
  const auth = await resolvePanelAuth(locale);
  if (auth.status === "unavailable") {
    return <SessionRecover />;
  }
  const session = auth.session;
  const [ops, menuConfig] = await Promise.all([
    opsPromise,
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
        partnerProjectKey: session.partnerProjectKey,
        adminRoleSlug: session.adminRoleSlug,
        permissions: Array.from(session.permissions),
      }}
    >
      <SentryUserSync />
      <ClearLocaleErrorRetries />
      <SidebarEpochsProvider access={session.epochs.access} menu={session.epochs.menu}>
        <SidebarMenuConfigProvider config={menuConfig}>
          <DashboardFrame>{children}</DashboardFrame>
        </SidebarMenuConfigProvider>
      </SidebarEpochsProvider>
    </AuthProvider>
  );
}
