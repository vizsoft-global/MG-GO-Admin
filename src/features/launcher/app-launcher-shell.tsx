"use client";

import { useTranslations } from "next-intl";
import { AppPage, AppPageHeader } from "@/components/app";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { resolveIcon } from "@/lib/menu/menu-registry";
import type { AppId } from "@/lib/menu/apps";

export function AppLauncherShell({ apps }: { apps: { id: AppId; href: string; icon: string }[] }) {
  const t = useTranslations("pages.launcher");

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {apps.map((app) => {
          const Icon = resolveIcon(app.icon);
          return (
            <Link key={app.id} href={app.href} className="group">
              <Card className="h-full rounded-xl border-border bg-card shadow-sm transition-colors group-hover:border-primary/40">
                <CardContent className="flex items-start gap-3 p-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {app.id === "employeedesk"
                        ? t("apps.employeedesk.title")
                        : app.id === "fleet"
                          ? t("apps.fleet.title")
                          : app.id === "operations"
                            ? t("apps.operations.title")
                            : app.id === "payroll"
                              ? t("apps.payroll.title")
                              : app.id === "live"
                                ? t("apps.live.title")
                                : t("apps.settings.title")}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {app.id === "employeedesk"
                        ? t("apps.employeedesk.body")
                        : app.id === "fleet"
                          ? t("apps.fleet.body")
                          : app.id === "operations"
                            ? t("apps.operations.body")
                            : app.id === "payroll"
                              ? t("apps.payroll.body")
                              : app.id === "live"
                                ? t("apps.live.body")
                                : t("apps.settings.body")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppPage>
  );
}
