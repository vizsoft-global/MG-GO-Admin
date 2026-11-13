"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { AppFormSection } from "@/components/app/app-form-section";
import { AppListCard } from "@/components/app/app-list-card";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatKwd, formatKwdAxis } from "@/lib/format/money";
import {
  buildServiceReport,
  reportDrillDownParams,
  type BreakdownRow,
} from "./service-reports-model";
import { SERVICE_CATEGORY_KEYS } from "./service-types";
import { downloadServiceReportXlsx } from "./service-reports-xlsx";
import { useServiceReports } from "./use-service";

function kwd(value: number): string {
  return formatKwd(value);
}

export function ServiceReportsTab({ canExport }: { canExport: boolean }) {
  const t = useTranslations("pages.fleetService");
  const locale = useLocale();
  const router = useRouter();
  const data = useServiceReports();
  const [year, setYear] = useState(() => kuwaitTodayYmd().slice(0, 4));
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");
  const [vendor, setVendor] = useState("all");
  const [partSort, setPartSort] = useState<"total" | "records" | "avgUnit" | "qty" | null>(null);

  function togglePartSort(next: "total" | "records" | "avgUnit" | "qty") {
    setPartSort((prev) => (prev === next ? null : next));
  }

  const records = useMemo(() => data.data?.records ?? [], [data.data]);
  const carType = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const vehicle of data.data?.vehicles ?? []) map.set(vehicle.id, vehicle.carType);
    return map;
  }, [data.data]);

  const years = useMemo(() => {
    const set = new Set<string>([kuwaitTodayYmd().slice(0, 4)]);
    for (const record of records) set.add(record.doneDay.slice(0, 4));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [records]);

  const typeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records) {
      const key = record.serviceTypeKey ?? "unknown";
      if (!map.has(key)) map.set(key, record.serviceTypeLabel ?? key);
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [records]);

  const vendorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const record of records) if (record.vendor) set.add(record.vendor);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [records]);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`),
    [year],
  );

  const scoped = useMemo(
    () =>
      records.filter((record) => {
        if (!record.doneDay.startsWith(`${year}-`)) return false;
        if (category !== "all" && record.category !== category) return false;
        if (type !== "all" && (record.serviceTypeKey ?? "unknown") !== type) return false;
        if (vendor !== "all" && (record.vendor ?? "") !== vendor) return false;
        return true;
      }),
    [records, year, category, type, vendor],
  );

  const report = useMemo(
    () => buildServiceReport({ records: scoped, carTypeByVehicleId: carType, locale, months }),
    [scoped, carType, locale, months],
  );

  const partRows = useMemo(() => {
    if (!partSort) return report.parts;
    const pick = (row: (typeof report.parts)[number]) => {
      if (partSort === "records") return row.records;
      if (partSort === "avgUnit") return row.avgUnitKwd;
      if (partSort === "qty") return row.qty;
      return row.totalKwd;
    };
    return [...report.parts].sort((a, b) => pick(b) - pick(a));
  }, [report.parts, partSort]);

  function drillDown(input: Parameters<typeof reportDrillDownParams>[0]) {
    const params = reportDrillDownParams({
      ...input,
      category: input.category ?? (category === "all" ? null : category),
      serviceTypeKey: input.serviceTypeKey ?? (type === "all" ? null : type),
      vendor: input.vendor ?? (vendor === "all" ? null : vendor),
    });
    router.push(`/fleet/service?${new URLSearchParams(params).toString()}`);
  }

  function breakdownCard(
    title: string,
    rows: BreakdownRow[],
    onPick: (row: BreakdownRow) => void,
  ) {
    return (
      <AppFormSection title={title}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reports.empty")}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.slice(0, 8).map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-start hover:bg-muted/60"
                  onClick={() => onPick(row)}
                >
                  <span className="truncate">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {kwd(row.totalKwd)} · {row.records}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AppFormSection>
    );
  }


  if (data.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("reports.loading")}</p>;
  }

  if (records.length === 0) {
    return <AppEmptyState title={t("reports.noDataTitle")} description={t("reports.noData")} />;
  }

  return (
    <div className="space-y-3">
      <KpiGrid
        compact
        items={[
          {
            label: t("reports.totalSpend"),
            value: kwd(report.kpis.totalKwd),
            selected: partSort === "total",
            onClick: () => togglePartSort("total"),
          },
          {
            label: t("reports.records"),
            value: report.kpis.records,
            selected: partSort === "records",
            onClick: () => togglePartSort("records"),
          },
          {
            label: t("reports.avgPerRecord"),
            value: kwd(report.kpis.avgPerRecordKwd),
            selected: partSort === "avgUnit",
            onClick: () => togglePartSort("avgUnit"),
          },
          {
            label: t("reports.topVehicle"),
            value: report.kpis.mostExpensiveVehicle
              ? `${report.kpis.mostExpensiveVehicle.label} · ${kwd(report.kpis.mostExpensiveVehicle.totalKwd)}`
              : "—",
            onClick: report.kpis.mostExpensiveVehicle
              ? () => drillDown({ vehicleId: report.kpis.mostExpensiveVehicle?.key ?? null })
              : undefined,
          },
          {
            label: t("reports.topPart"),
            value: report.kpis.mostReplacedPart
              ? `${report.kpis.mostReplacedPart.name} · ${report.kpis.mostReplacedPart.qty}`
              : "—",
            selected: partSort === "qty",
            onClick: () => togglePartSort("qty"),
          },
        ]}
      />

      <AppListCard>
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3">
          <div className="w-[8rem] space-y-1 text-xs">
            <span className="block text-muted-foreground">{t("reports.year")}</span>
            <Select
              items={years.map((value) => ({ value, label: value }))}
              value={year}
              onValueChange={(value) => setYear(value ?? "")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[10rem] space-y-1 text-xs">
            <span className="block text-muted-foreground">{t("filters.category")}</span>
            <Select
              items={[
                { value: "all", label: t("filters.any") },
                ...SERVICE_CATEGORY_KEYS.map((key) => ({
                  value: key,
                  label: t(`categories.${key}`),
                })),
              ]}
              value={category}
              onValueChange={(value) => setCategory(value ?? "all")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.any")}</SelectItem>
                {SERVICE_CATEGORY_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`categories.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[12rem] space-y-1 text-xs">
            <span className="block text-muted-foreground">{t("filters.type")}</span>
            <Select
              items={[{ value: "all", label: t("filters.any") }, ...typeOptions]}
              value={type}
              onValueChange={(value) => setType(value ?? "all")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.any")}</SelectItem>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[10rem] space-y-1 text-xs">
            <span className="block text-muted-foreground">{t("filters.vendor")}</span>
            <Select
              items={[
                { value: "all", label: t("filters.any") },
                ...vendorOptions.map((value) => ({ value, label: value })),
              ]}
              value={vendor}
              onValueChange={(value) => setVendor(value ?? "all")}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.any")}</SelectItem>
                {vendorOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canExport ? (
            <Button
              type="button"
              variant="outline"
              className="ms-auto h-9"
              onClick={() =>
                void downloadServiceReportXlsx(report, {
                  year,
                  labelCategory: (key) => t(`categories.${key}`),
                  labelOwnership: (ownership) => t(`reports.${ownership}`),
                })
              }
            >
              {t("actions.export")}
            </Button>
          ) : null}
        </div>

        <div className="px-4 py-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("reports.chartTitle")}</span>
            <span>
              {t("reports.contract")} = {t("reports.contractHint")} · {t("reports.service")} ={" "}
              {t("reports.serviceHint")}
            </span>
          </div>
          <div className="h-[min(320px,42dvh)] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={report.monthly.map((point) => ({ ...point, label: point.month.slice(5) }))}
                margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickMargin={6} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => formatKwdAxis(Number(value))} />
                <Tooltip formatter={(value) => formatKwd(Number(value))} />
                <Legend />
                <Bar
                  dataKey="contractKwd"
                  name={t("reports.contract")}
                  stackId="spend"
                  fill="#1E3A5F"
                  cursor="pointer"
                  onClick={(entry) =>
                    drillDown({ month: (entry as unknown as { month: string }).month })
                  }
                />
                <Bar
                  dataKey="serviceKwd"
                  name={t("reports.service")}
                  stackId="spend"
                  fill="#A73C24"
                  cursor="pointer"
                  onClick={(entry) =>
                    drillDown({ month: (entry as unknown as { month: string }).month })
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </AppListCard>

      <div className="grid gap-3 lg:grid-cols-2">
        {breakdownCard(t("reports.byCategory"), report.byCategory, (row) =>
          drillDown({ category: row.key }),
        )}
        {breakdownCard(t("reports.byServiceType"), report.byServiceType, (row) =>
          drillDown({ serviceTypeKey: row.key }),
        )}
        {breakdownCard(t("reports.byVendor"), report.byVendor, (row) =>
          drillDown({ vendor: row.label === "—" ? null : row.label }),
        )}
        {breakdownCard(t("reports.byVehicle"), report.byVehicle, (row) =>
          drillDown({ vehicleId: row.key }),
        )}
      </div>

      <AppFormSection title={t("reports.partsTitle")} description={t("reports.partsHint")}>
        {report.parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reports.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="pb-1 text-start font-medium">{t("form.partName")}</th>
                <th className="pb-1 text-end font-medium">{t("reports.partQty")}</th>
                <th className="pb-1 text-end font-medium">{t("reports.partAvg")}</th>
                <th className="pb-1 text-end font-medium">{t("reports.partTotal")}</th>
                <th className="pb-1 text-end font-medium">{t("reports.records")}</th>
              </tr>
            </thead>
            <tbody>
              {partRows.slice(0, 25).map((part) => (
                <tr key={part.name} className="border-t border-border">
                  <td className="py-1.5">{part.name}</td>
                  <td className="py-1.5 text-end tabular-nums">{part.qty}</td>
                  <td className="py-1.5 text-end tabular-nums">{kwd(part.avgUnitKwd)}</td>
                  <td className="py-1.5 text-end tabular-nums">{kwd(part.totalKwd)}</td>
                  <td className="py-1.5 text-end tabular-nums">{part.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AppFormSection>
    </div>
  );
}
