import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/auth/require-permission";
import { getAppOpsSettings } from "@/lib/auth/app-settings";
import { redirect } from "@/i18n/navigation";
import { AuthProvider } from "@/contexts/auth-context";
import { SidebarMenuConfigProvider } from "@/contexts/sidebar-menu-context";
import { getMenuConfigServer } from "@/services/menu-config-server";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppSecondaryNav } from "@/components/layout/app-secondary-nav";
import { SentryUserSync } from "@/components/system/sentry-user-sync";
import { LAYOUT } from "@/components/app/layout-spacing";
import { DriverImportJobProvider } from "@/features/drivers/import/driver-import-job-provider";
import { cn } from "@/lib/utils";

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
        adminRoleSlug: session.adminRoleSlug,
        permissions: Array.from(session.permissions),
      }}
    >
      <SentryUserSync />
      <SidebarMenuConfigProvider config={menuConfig}>
        <div className="flex h-svh w-full overflow-hidden bg-background">
          <SidebarProvider className="flex h-svh w-full overflow-hidden">
            <AppSidebar />
            <SidebarInset className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden bg-muted/30">
              <div className="flex h-full min-h-0 overflow-hidden bg-muted/30">
                <AppSecondaryNav />
                <main className={cn("flex-1 overflow-auto bg-muted/30", LAYOUT.commandPageInset)}>
                  <DriverImportJobProvider>{children}</DriverImportJobProvider>
                </main>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </SidebarMenuConfigProvider>
    </AuthProvider>
  );
}
