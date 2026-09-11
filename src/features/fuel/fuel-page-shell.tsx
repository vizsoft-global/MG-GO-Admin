"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FuelCompanyBadge, FuelTypeBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { addKuwaitDays, formatKuwaitDayLabel, kuwaitSatFriWeek, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { FuelFillDialog } from "./fuel-fill-dialog";
import { formatKwd, buildFuelWeekRows, fuelWeekMatchesSearch } from "./fuel-week";
import { useFuelFills } from "./use-fuel";
import type { FuelWeekRow } from "./types";

export function FuelPageShell({ initialAnchor }: { initialAnchor: string }) {
  const t = useTranslations("pages.fuel");
  const [anchor, setAnchor] = useState(initialAnchor);
  const [search, setSearch] = useState("");
  const [projectKey, setProjectKey] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const week = useMemo(() => kuwaitSatFriWeek(anchor), [anchor]);
  const monthPrefix = week.start.slice(0, 7);
  const { data, isPending } = useFuelFills({
    from: `${monthPrefix}-01`,
    to: week.end,
    projectKey: projectKey === "all" ? null : projectKey,
  });
  const fills = data ?? [];
  const isLoading = data === undefined || isPending;

  const rows = useMemo(
    () => buildFuelWeekRows(fills, week.days, monthPrefix).filter((row) => fuelWeekMatchesSearch(row, search)),
    [fills, monthPrefix, search, week.days],
  );
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <AppListCard
        title={t("weekTitle", {
          from: formatKuwaitDayLabel(week.start),
          to: formatKuwaitDayLabel(week.end),
          count: mounted ? rows.length : 0,
        })}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                className="h-9 w-9 p-0"
                onClick={() => setAnchor(addKuwaitDays(week.start, -7))}
                aria-label={t("prevWeek")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => setAnchor(kuwaitTodayYmd())}
              >
                {t("thisWeek")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 w-9 p-0"
                onClick={() => setAnchor(addKuwaitDays(week.start, 7))}
                aria-label={t("nextWeek")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 ps-8"
              />
            </div>
            <Select
              items={[
                { value: "all", label: t("projectAll") },
                { value: "keeta", label: t("projectKeeta") },
                { value: "americana", label: t("projectAmericana") },
              ]}
              value={projectKey}
              onValueChange={(value) => {
                if (value) setProjectKey(value);
              }}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" label={t("projectAll")}>
                  {t("projectAll")}
                </SelectItem>
                <SelectItem value="keeta" label={t("projectKeeta")}>
                  {t("projectKeeta")}
                </SelectItem>
                <SelectItem value="americana" label={t("projectAmericana")}>
                  {t("projectAmericana")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        {!mounted || isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : fills.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "employee", label: t("colEmployee") },
              { id: "plate", label: t("colPlate") },
              { id: "chip", label: t("colChip") },
              { id: "fuelType", label: t("colFuelType") },
              { id: "fuelCompany", label: t("colFuelCompany") },
              { id: "project", label: t("colProject") },
              { id: "zone", label: t("colZone") },
              { id: "limit", label: t("colMonthlyLimit") },
              { id: "withdrawn", label: t("colWithdrawn") },
              ...week.days.map((day) => ({ id: day, label: formatKuwaitDayLabel(day) })),
            ]}
            empty={rows.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {rows.map((row) => (
              <FuelRow key={row.key} row={row} onOpen={() => setSelectedKey(row.key)} />
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <FuelFillDialog
        open={Boolean(selected)}
        row={selected}
        weekDays={week.days}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null);
        }}
      />
    </AppPage>
  );
}

function FuelRow({ row, onOpen }: { row: FuelWeekRow; onOpen: () => void }) {
  return (
    <AppDataTableRow
      className={row.critical ? "bg-destructive/10 hover:bg-destructive/15" : undefined}
      onClick={onOpen}
    >
      <TableCell className="whitespace-nowrap">
        <p className="font-medium">{row.driverName ?? "—"}</p>
        {row.employeeId ? <p className="text-[11px] text-muted-foreground">{row.employeeId}</p> : null}
      </TableCell>
      <TableCell className="whitespace-nowrap font-medium">{row.plate ?? "—"}</TableCell>
      <TableCell className="font-mono text-[11px]">{row.chip ?? "—"}</TableCell>
      <TableCell>
        <FuelTypeBadge value={row.fuelType} />
      </TableCell>
      <TableCell>
        <FuelCompanyBadge value={row.fuelCompany} />
      </TableCell>
      <TableCell>
        <ProjectBadge value={row.projectKey} />
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.zone ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{formatKwd(row.monthlyLimit)} KWD</TableCell>
      <TableCell className={row.critical ? "font-semibold text-destructive" : undefined}>
        <p>{formatKwd(row.withdrawn)} KWD</p>
        {row.monthlyLimit > 0 ? (
          <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${row.critical ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${Math.min(100, (row.withdrawn / row.monthlyLimit) * 100)}%` }}
            />
          </div>
        ) : null}
      </TableCell>
      {row.days.map((cell, index) => (
        <TableCell key={index} className="whitespace-nowrap">
          {cell ? (
            <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
              {formatKwd(cell.costKwd)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      ))}
    </AppDataTableRow>
  );
}
