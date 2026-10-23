"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { catalogLabel } from "./employee-catalogs";
import { fetchEmployeesDashboard } from "./employees-dashboard-actions";
import { useBankCodes, useEmployeeSections, useEmployeeStatuses, useNationalityCategories } from "./use-employee-catalogs";
import type { EmployeesDashboardBucket } from "./employees-dashboard";

const TILE = [
  "bg-[#C27047] text-white",
  "bg-[#478F75] text-white",
  "bg-[#544D99] text-white",
  "bg-[#B8474D] text-white",
  "bg-[#3B6EA5] text-white",
  "bg-[#8B5CF6] text-white",
] as const;

function BucketGrid({
  title,
  buckets,
  labels,
}: {
  title: string;
  buckets: EmployeesDashboardBucket[];
  labels: (key: string) => string;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {buckets.length === 0 ? (
          <p className="col-span-full text-xs text-muted-foreground">—</p>
        ) : (
          buckets.map((bucket, index) => (
            <Card key={bucket.key} className={`rounded-xl border-0 shadow-sm ${TILE[index % TILE.length]}`}>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide opacity-80">
                  {labels(bucket.key)}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{bucket.count}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </section>
  );
}

export function EmployeesDashboardShell() {
  const t = useTranslations("pages.drivers.employeesDashboard");
  const locale = useLocale();
  const statuses = useEmployeeStatuses();
  const sections = useEmployeeSections();
  const nations = useNationalityCategories();
  const dash = useQuery({
    queryKey: queryKeys.employees.dashboard(),
    queryFn: fetchEmployeesDashboard,
    staleTime: 30_000,
  });
  const data = dash.data;

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Link href="/drivers" className="text-sm text-primary hover:underline">
            {t("backToList")}
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card className="rounded-xl border-border bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("live")}</p>
            <p className="text-2xl font-bold tabular-nums">{data?.total ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border bg-card shadow-sm">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t("archived")}</p>
            <p className="text-2xl font-bold tabular-nums">{data?.archived ?? "—"}</p>
          </CardContent>
        </Card>
      </div>
      <BucketGrid
        title={t("byProject")}
        buckets={data?.by_project ?? []}
        labels={(key) => (key === "unassigned" ? t("unassigned") : key)}
      />
      <BucketGrid
        title={t("byPartner")}
        buckets={data?.by_partner ?? []}
        labels={(key) => (key === "unassigned" ? t("unassigned") : key)}
      />
      <BucketGrid
        title={t("byStatus")}
        buckets={data?.by_employee_status ?? []}
        labels={(key) => catalogLabel(key === "unassigned" ? null : key, statuses.data ?? [], locale)}
      />
      <BucketGrid
        title={t("byNationality")}
        buckets={data?.by_nationality_category ?? []}
        labels={(key) => catalogLabel(key === "unassigned" ? null : key, nations.data ?? [], locale)}
      />
      <BucketGrid
        title={t("bySection")}
        buckets={data?.by_section ?? []}
        labels={(key) => catalogLabel(key === "unassigned" ? null : key, sections.data ?? [], locale)}
      />
    </AppPage>
  );
}
