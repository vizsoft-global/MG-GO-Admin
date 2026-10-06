"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { AppSecondaryNav } from "@/components/layout/app-secondary-nav";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { LAYOUT } from "@/components/app/layout-spacing";
import { DriverImportJobProvider } from "@/features/drivers/import/driver-import-job-provider";
import { cn } from "@/lib/utils";
import { LAUNCHER_BRAND } from "@/lib/menu/module-colors";

export function DashboardFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLauncher = pathname === "/dashboard";

  if (isLauncher) {
    return (
      <div className="flex h-svh w-full overflow-hidden" style={{ backgroundColor: LAUNCHER_BRAND.canvas }}>
        <main className="flex-1 overflow-auto">{children}</main>
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
