"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  CalendarDays,
  Download,
  ExternalLink,
  GitCompareArrows,
  Loader2,
  Store,
  Upload,
  UserX,
} from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { ToggleChip } from "@/components/app/toggle-chip";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { useAuth } from "@/contexts/auth-context";
import { getLatestOrderRecon, listOrderReconRuns } from "./order-recon-actions";
import { OrderReconImportDialog } from "./order-recon-import-dialog";
import { buildOrderReconWorkbook, downloadOrderReconXlsx } from "./order-recon-xlsx";
import {
  buildReconViews,
  buildRunProgress,
  employeeLabel,
  persistReconKpi,
  riderGroupKey,
} from "./order-recon-views";

type ReconTab = "daily" | "progress" | "unused";

function ReconProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function OrderReconPageShell() {
  const t = useTranslations("pages.orderRecon");
  const { can } = useAuth();
  const canManage = can("deliveries.manage");
  const router = useRouter();
  const { data: latest, isLoading } = useQuery({
    queryKey: queryKeys.orderRecon.latest(),
    queryFn: getLatestOrderRecon,
  });
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: queryKeys.orderRecon.runs(),
    queryFn: listOrderReconRuns,
  });

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [onlyMismatches, setOnlyMismatches] = useState(true);
  const [tab, setTab] = useState<ReconTab>("daily");
  const [byRestaurant, setByRestaurant] = useState(false);

  const rows = latest?.rows ?? [];
  const views = useMemo(() => buildReconViews(rows), [rows]);
  const kpi = views.kpi;

  const visibleDaily = useMemo(() => {
    const source = byRestaurant ? views.store : views.daily;
    return onlyMismatches ? source.filter((r) => r.status !== "match") : source;
  }, [byRestaurant, onlyMismatches, views.daily, views.store]);

  const openRun = (runId: string, employeeKey?: string) => {
    const href = employeeKey
      ? `/deliveries/reconciliation/${runId}?employee=${encodeURIComponent(employeeKey)}`
      : `/deliveries/reconciliation/${runId}`;
    router.push(href);
  };

  const onExport = () => {
    startTransition(async () => {
      const buf = await buildOrderReconWorkbook(rows);
      downloadOrderReconXlsx(buf, `order-recon-${latest?.from_date ?? "export"}.xlsx`);
    });
  };

  const dailyColumns = byRestaurant
    ? [
        { id: "employee", label: t("colEmployee") },
        { id: "restaurant", label: t("colRestaurant") },
        { id: "date", label: t("colDate") },
        { id: "excel", label: t("colExcel") },
        { id: "app", label: t("colApp") },
        { id: "diff", label: t("colDiff") },
      ]
    : [
        { id: "employee", label: t("colEmployee") },
        { id: "date", label: t("colDate") },
        { id: "excel", label: t("colExcel") },
        { id: "app", label: t("colApp") },
        { id: "diff", label: t("colDiff") },
      ];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={!latest || rows.length === 0}
              onClick={onExport}
            >
              <Download className="size-4" />
              {t("export")}
            </Button>
            {canManage ? (
              <Button type="button" className="h-9 cursor-pointer" onClick={() => setOpen(true)}>
                <Upload className="size-4" />
                {t("upload")}
              </Button>
            ) : null}
          </div>
        }
      />

      <KpiGrid
        items={[
          { label: t("kpiCompared"), value: kpi.compared },
          { label: t("kpiMismatches"), value: kpi.mismatches, accent: "danger" },
          { label: t("kpiUnresolved"), value: kpi.unresolved, accent: "warning" },
          { label: t("kpiAppOnly"), value: kpi.app_only },
          { label: t("kpiUnused"), value: kpi.not_using_app, accent: "warning" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip
          selected={tab === "daily"}
          icon={CalendarDays}
          className="h-9"
          onClick={() => setTab("daily")}
        >
          {t("tabDaily")}
        </ToggleChip>
        <ToggleChip
          selected={tab === "progress"}
          icon={GitCompareArrows}
          className="h-9"
          onClick={() => setTab("progress")}
        >
          {t("tabProgress")}
        </ToggleChip>
        <ToggleChip
          selected={tab === "unused"}
          icon={UserX}
          className="h-9"
          onClick={() => setTab("unused")}
        >
          {t("tabUnused")}
        </ToggleChip>
      </div>

      {tab === "progress" ? (
        <AppListCard
          toolbar={
            <p className="text-xs text-muted-foreground">
              {runs[0]
                ? t("runMeta", { file: runs[0].file_name, from: runs[0].from_date, to: runs[0].to_date })
                : t("emptyHint")}
            </p>
          }
        >
          {runsLoading ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <AppDataTableEmpty>{t("progressEmpty")}</AppDataTableEmpty>
          ) : (
            <div className="space-y-2 p-3">
              {runs.map((run) => {
                const progress = buildRunProgress(
                  latest && run.id === latest.id
                    ? { ...run, kpi: persistReconKpi(latest.rows) }
                    : run,
                );
                return (
                  <Link
                    key={run.id}
                    href={`/deliveries/reconciliation/${run.id}`}
                    className="block cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{run.file_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {run.from_date} – {run.to_date}
                          {" · "}
                          {t(`importStatus.${run.status}`)}
                        </p>
                      </div>
                      <span className="inline-flex h-9 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:bg-primary/10">
                        <ExternalLink className="size-4" />
                        {t("track")}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("runDaysMatch", { matched: progress.matched_days, total: progress.sheet_days })}
                      {" · "}
                      {t("runMismatches", { count: progress.mismatches })}
                      {" · "}
                      {t("kpiUnused")}: {progress.unused}
                      {" · "}
                      {t("kpiUnresolved")}: {progress.unresolved}
                      {" · "}
                      {t("kpiAppOnly")}: {progress.app_only}
                    </p>
                    <div className="mt-2">
                      <ReconProgressBar pct={progress.pct} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </AppListCard>
      ) : (
        <AppListCard
          toolbar={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {latest
                  ? t("runMeta", { file: latest.file_name, from: latest.from_date, to: latest.to_date })
                  : t("emptyHint")}
              </p>
              {tab === "daily" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ToggleChip
                    selected={byRestaurant}
                    icon={Store}
                    className="h-9"
                    onClick={() => setByRestaurant((v) => !v)}
                  >
                    {t("byRestaurant")}
                  </ToggleChip>
                  <Button
                    type="button"
                    variant={onlyMismatches ? "default" : "outline"}
                    className="h-9 cursor-pointer"
                    onClick={() => setOnlyMismatches((v) => !v)}
                  >
                    {onlyMismatches ? t("showMismatches") : t("showAll")}
                  </Button>
                </div>
              ) : null}
            </div>
          }
        >
          {isLoading ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tab === "unused" ? (
            <AppDataTable
              columns={[
                { id: "employee", label: t("colEmployee") },
                { id: "excel", label: t("colExcel") },
                { id: "days", label: t("colDaysWithExcel") },
                { id: "app", label: t("colApp") },
              ]}
              empty={
                views.unused.length === 0 ? (
                  <AppDataTableEmpty>{t("unusedEmpty")}</AppDataTableEmpty>
                ) : undefined
              }
            >
              {views.unused.map((row) => (
                <AppDataTableRow
                  key={row.id}
                  onClick={latest ? () => openRun(latest.id, row.employee_id) : undefined}
                >
                  <TableCell className="px-3 py-2 text-sm">
                    <div className="font-medium">
                      {employeeLabel(row.employee_name, row.employee_id) || "—"}
                    </div>
                    {row.employee_name.trim() && row.employee_id.trim() ? (
                      <div className="text-[10px] text-muted-foreground">{row.employee_id}</div>
                    ) : null}
                    {latest ? (
                      <div className="text-[10px] text-primary">{t("viewDetails")}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-sm">{row.excel_orders}</TableCell>
                  <TableCell className="px-3 py-2 text-sm">{row.days_with_excel}</TableCell>
                  <TableCell className="px-3 py-2 text-sm">{row.app_orders}</TableCell>
                </AppDataTableRow>
              ))}
            </AppDataTable>
          ) : (
            <AppDataTable
              columns={dailyColumns}
              empty={
                visibleDaily.length === 0 ? <AppDataTableEmpty>{t("emptyRows")}</AppDataTableEmpty> : undefined
              }
            >
              {visibleDaily.map((row) => {
                const employeeKey = "rider_key" in row ? row.rider_key : riderGroupKey(row);
                return (
                  <AppDataTableRow
                    key={row.id}
                    onClick={latest ? () => openRun(latest.id, employeeKey) : undefined}
                  >
                    <TableCell className="px-3 py-2 text-sm">
                      <div className="font-medium">
                        {employeeLabel(row.employee_name, row.employee_id) || "—"}
                      </div>
                      {row.employee_name.trim() && row.employee_id.trim() ? (
                        <div className="text-[10px] text-muted-foreground">{row.employee_id}</div>
                      ) : null}
                      {latest ? (
                        <div className="text-[10px] text-primary">{t("viewDetails")}</div>
                      ) : null}
                    </TableCell>
                    {byRestaurant && "restaurant_name" in row ? (
                      <TableCell className="px-3 py-2 text-sm">{row.restaurant_name || "—"}</TableCell>
                    ) : null}
                    <TableCell className="px-3 py-2 text-sm">{row.work_date}</TableCell>
                    <TableCell className="px-3 py-2 text-sm">{row.excel_orders}</TableCell>
                    <TableCell className="px-3 py-2 text-sm">{row.app_orders}</TableCell>
                    <TableCell className="px-3 py-2 text-sm font-medium">{row.difference}</TableCell>
                  </AppDataTableRow>
                );
              })}
            </AppDataTable>
          )}
        </AppListCard>
      )}

      {tab === "daily" && views.unresolved.length > 0 ? (
        <AppListCard
          toolbar={
            <div>
              <p className="text-sm font-semibold">{t("unresolvedTitle")}</p>
              <p className="text-[10px] text-muted-foreground">{t("unresolvedHint")}</p>
            </div>
          }
        >
          <ul className="max-h-48 space-y-1 overflow-auto px-3 py-2 text-xs">
            {views.unresolved.map((row) => (
              <li key={row.id}>
                {employeeLabel(row.employee_name, row.employee_id) || "—"} · {row.restaurant_name || "—"} ·{" "}
                {row.work_date} · {row.excel_orders}
              </li>
            ))}
          </ul>
        </AppListCard>
      ) : null}

      <OrderReconImportDialog open={open} onOpenChange={setOpen} />
    </AppPage>
  );
}
