"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BarChart3, ExternalLink, Loader2 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useAdminRequestsList } from "@/features/requests/use-requests";

export function EsignReportsShell() {
  const t = useTranslations("pages.requests.esign.reports");
  const filters = useMemo(
    () => ({
      datePreset: "this_month" as const,
      limit: 1,
      offset: 0,
    }),
    [],
  );
  const { data, isLoading } = useAdminRequestsList(filters);
  const kpi = data?.kpi;

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: t("requests"), href: "/requests" },
          { label: t("title") },
        ]}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            render={<Link href="/requests/settings/reports" />}
          >
            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
            {t("fullReports")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <KpiGrid
          items={[
            { label: t("kpi.total"), value: kpi?.total ?? "—" },
            { label: t("kpi.pending"), value: kpi?.pending ?? "—", accent: "warning" },
            { label: t("kpi.overdue"), value: kpi?.overdue ?? "—", accent: "danger" },
            {
              label: t("kpi.avgResolution"),
              value:
                kpi?.avg_resolution_seconds != null
                  ? `${(kpi.avg_resolution_seconds / 86400).toFixed(1)}d`
                  : "—",
            },
          ]}
        />
      )}

      <AppListCard className="mt-2 flex flex-col items-center gap-2 p-8 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/30">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
        </span>
        <p className="text-sm font-medium">{t("stubTitle")}</p>
        <p className="max-w-md text-[11px] text-muted-foreground">{t("stubBody")}</p>
      </AppListCard>
    </AppPage>
  );
}
