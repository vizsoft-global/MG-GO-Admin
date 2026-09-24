"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Smartphone, UserX } from "lucide-react";
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
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { getOrderRecon } from "./order-recon-actions";
import { reconStatusVariant } from "./recon-status";
import {
  buildRunEmployees,
  dailyForEmployee,
  employeeLabel,
  type OrderReconEmployee,
} from "./order-recon-views";

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

export function OrderReconDetailShell({ runId }: { runId: string }) {
  const t = useTranslations("pages.orderRecon");
  const router = useRouter();
  const [employeeKey, setEmployeeKey] = useState<string | null>(null);
  const [bucket, setBucket] = useState<"in_app" | "blank">("in_app");

  useEffect(() => {
    const sync = () => setEmployeeKey(new URLSearchParams(window.location.search).get("employee"));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const { data: run, isLoading } = useQuery({
    queryKey: queryKeys.orderRecon.detail(runId),
    queryFn: () => getOrderRecon(runId),
  });

  const employees = useMemo(() => buildRunEmployees(run?.rows ?? []), [run?.rows]);

  useEffect(() => {
    if (!employeeKey) return;
    if (employees.blank.some((row) => row.key === employeeKey)) setBucket("blank");
    else if (employees.in_app.some((row) => row.key === employeeKey)) setBucket("in_app");
  }, [employeeKey, employees.blank, employees.in_app]);

  const list = bucket === "in_app" ? employees.in_app : employees.blank;
  const selected = list.find((row) => row.key === employeeKey) ?? null;
  const daily = useMemo(
    () => (employeeKey && run ? dailyForEmployee(run.rows, employeeKey) : []),
    [employeeKey, run],
  );

  const selectEmployee = (key: string) => {
    setEmployeeKey(key);
    router.replace(`/deliveries/reconciliation/${runId}?employee=${encodeURIComponent(key)}`);
  };

  const statusLabel = (status: OrderReconEmployee["status"] | "match" | "mismatch" | "app_only") => {
    if (status === "match") return t("statusMatch");
    if (status === "unused") return t("statusUnused");
    if (status === "unresolved") return t("statusUnresolved");
    if (status === "app_only") return t("kpiAppOnly");
    return t("statusMismatch");
  };

  return (
    <AppPage>
      <AppPageHeader
        title={run?.file_name ?? t("title")}
        description={
          run ? t("runMeta", { file: run.file_name, from: run.from_date, to: run.to_date }) : t("emptyHint")
        }
        breadcrumbs={[
          { label: t("title"), href: "/deliveries/reconciliation" },
          { label: run?.file_name ?? t("tabProgress") },
        ]}
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-9 cursor-pointer"
            onClick={() => router.push("/deliveries/reconciliation")}
          >
            <ArrowLeft className="size-4" />
            {t("backToList")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip
          selected={bucket === "in_app"}
          icon={Smartphone}
          className="h-9"
          onClick={() => setBucket("in_app")}
        >
          {t("tabInApp")}
        </ToggleChip>
        <ToggleChip
          selected={bucket === "blank"}
          icon={UserX}
          className="h-9"
          onClick={() => setBucket("blank")}
        >
          {t("tabBlank")}
        </ToggleChip>
      </div>

      {bucket === "blank" ? (
        <p className="text-[10px] text-muted-foreground">{t("blankHint")}</p>
      ) : null}

      <AppListCard
        toolbar={<p className="text-sm font-semibold">{t("employeeProgress")}</p>}
      >
        {isLoading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <AppDataTable
            columns={[
              { id: "employee", label: t("colEmployee") },
              { id: "excel", label: t("colExcel") },
              { id: "app", label: t("colApp") },
              { id: "diff", label: t("colDiff") },
              { id: "days", label: t("colDaysMatched") },
              { id: "status", label: t("colStatus") },
            ]}
            empty={list.length === 0 ? <AppDataTableEmpty>{t("emptyRows")}</AppDataTableEmpty> : undefined}
          >
            {list.map((row) => (
              <AppDataTableRow
                key={row.key}
                data-selected={row.key === employeeKey ? "true" : undefined}
                className={row.key === employeeKey ? "bg-primary/10" : undefined}
                onClick={() => selectEmployee(row.key)}
              >
                <TableCell className="px-3 py-2 text-sm">
                  <div className="font-medium">
                    {employeeLabel(row.employee_name, row.employee_id) || "—"}
                  </div>
                  {row.employee_name.trim() && row.employee_id.trim() ? (
                    <div className="text-[10px] text-muted-foreground">{row.employee_id}</div>
                  ) : null}
                  <div className="mt-1">
                    <ReconProgressBar pct={row.pct} />
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.excel_orders}</TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.app_orders}</TableCell>
                <TableCell className="px-3 py-2 text-sm font-medium">{row.difference}</TableCell>
                <TableCell className="px-3 py-2 text-sm">
                  {row.days_matched}/{row.days_in_sheet}
                </TableCell>
                <TableCell className="px-3 py-2 text-sm">
                  <StatusPill variant={reconStatusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <AppListCard
        toolbar={
          <p className="text-sm font-semibold">
            {selected
              ? employeeLabel(selected.employee_name, selected.employee_id)
              : t("selectEmployee")}
          </p>
        }
      >
        {!employeeKey ? (
          <AppDataTableEmpty>{t("selectEmployee")}</AppDataTableEmpty>
        ) : (
          <AppDataTable
            columns={[
              { id: "date", label: t("colDate") },
              { id: "excel", label: t("colExcel") },
              { id: "app", label: t("colApp") },
              { id: "diff", label: t("colDiff") },
              { id: "status", label: t("colStatus") },
            ]}
            empty={daily.length === 0 ? <AppDataTableEmpty>{t("emptyRows")}</AppDataTableEmpty> : undefined}
          >
            {daily.map((row) => (
              <AppDataTableRow key={row.id}>
                <TableCell className="px-3 py-2 text-sm">{row.work_date}</TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.excel_orders}</TableCell>
                <TableCell className="px-3 py-2 text-sm">{row.app_orders}</TableCell>
                <TableCell className="px-3 py-2 text-sm font-medium">{row.difference}</TableCell>
                <TableCell className="px-3 py-2 text-sm">
                  <StatusPill variant={reconStatusVariant(row.status)}>{statusLabel(row.status)}</StatusPill>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}
