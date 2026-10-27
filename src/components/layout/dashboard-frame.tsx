"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { AppSecondaryNav } from "@/components/layout/app-secondary-nav";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LAYOUT } from "@/components/app/layout-spacing";
import { DriverImportJobProvider } from "@/features/drivers/import/driver-import-job-provider";
import { cn } from "@/lib/utils";
import { LAUNCHER_BRAND } from "@/lib/menu/module-colors";

export function DashboardFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { accessKind } = useAuth();
  const isLauncher = pathname === "/dashboard";

  useEffect(() => {
    if (accessKind !== "partner") return;
    const allowed =
      pathname === "/client-portal" ||
      pathname.startsWith("/client-portal/") ||
      pathname === "/operations-dashboard" ||
      pathname.startsWith("/operations-dashboard/");
    if (!allowed) router.replace("/client-portal");
  }, [accessKind, pathname, router]);

  if (isLauncher) {
    return (
      <div className="flex h-dvh min-h-svh w-full overflow-hidden" style={{ backgroundColor: LAUNCHER_BRAND.canvas }}>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    );
  }

  return (
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
  );
}
