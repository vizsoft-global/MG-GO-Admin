"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, ExternalLink, Loader2, Pencil, Search, SlidersHorizontal } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FuelCompanyBadge, FuelTypeBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { Link, useRouter } from "@/i18n/navigation";
import { formatKuwaitDayLabel, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { FleetRequestDialog } from "./fleet-request-dialog";
import { FLEET_REQUEST_CHIP_CLASS } from "./fleet-request-utils";
import type { FleetRequestListRow } from "./fleet-request-types";
import { FuelFillDialog } from "./fuel-fill-dialog";
import { resolveFuelRange, shiftFuelAnchor, type FuelRangeMode } from "./fuel-range";
import { FuelWithdrawnDialog } from "./fuel-withdrawn-dialog";
import { applyWithdrawnOverride, formatKwd, buildFuelWeekRows, fuelWeekMatchesSearch, withFuelRequestRows, type FuelLogRow } from "./fuel-week";
import { useFleetRequests } from "./use-fleet-requests";
import { useFuelFills, useFuelWithdrawnOverrides } from "./use-fuel";

export function FuelPageShell({ initialAnchor }: { initialAnchor: string }) {
  const t = useTranslations("pages.fuel");
  const [mode, setMode] = useState<FuelRangeMode>("weekly");
  const [customOpen, setCustomOpen] = useState(false);
  const [anchor, setAnchor] = useState(initialAnchor);
  const [draftFrom, setDraftFrom] = useState(initialAnchor);
  const [draftTo, setDraftTo] = useState(initialAnchor);
  const [appliedFrom, setAppliedFrom] = useState(initialAnchor);
  const [appliedTo, setAppliedTo] = useState(initialAnchor);
  const [rangeError, setRangeError] = useState<"order" | "span" | null>(null);
  const [search, setSearch] = useState("");
  const [projectKey, setProjectKey] = useState<string>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<FleetRequestListRow | null>(null);
  const [editRow, setEditRow] = useState<FuelLogRow | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const resolved = useMemo(
    () => resolveFuelRange({ mode, anchor, customFrom: appliedFrom, customTo: appliedTo }),
    [anchor, appliedFrom, appliedTo, mode],
  );
  const range = resolved.ok ? resolved.range : { start: anchor, end: anchor, days: [anchor] };
  const { data, isPending } = useFuelFills({
    from: range.start,
    to: range.end,
    projectKey: projectKey === "all" ? null : projectKey,
  });
  const fuelRequests = useFleetRequests("fuel");
  const refundRequests = useFleetRequests("fuel_refund");
  const fills = data ?? [];
  const isLoading = data === undefined || isPending;

  const monthKey = range.start.slice(0, 7);
  const withdrawnOverrides = useFuelWithdrawnOverrides(monthKey);
  const daySet = useMemo(() => new Set(range.days), [range.days]);
  const requestRows = useMemo(() => {
    const listed = [...(fuelRequests.data?.rows ?? []), ...(refundRequests.data?.rows ?? [])];
    return listed
      .filter((row) => row.request_type !== "asset" && daySet.has(toKuwaitYmd(row.created_at)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [daySet, fuelRequests.data, refundRequests.data]);
  const rows = useMemo(() => {
    const fillsOnly = buildFuelWeekRows(fills, range.days, range.start.slice(0, 7));
    const requests = requestRows.flatMap((row) =>
      row.request_type === "fuel" || row.request_type === "fuel_refund"
        ? [
            {
              id: row.id,
              request_code: row.request_code,
              request_type: row.request_type,
              driver_id: row.driver_id,
              driver_name: row.driver_name,
              employee_id: row.employee_id,
              employee_company: row.employee_company,
              vehicle_id: row.vehicle_id,
              plate: row.plate,
              vehicle_model: row.vehicle_model,
              vehicle_company: row.vehicle_company,
              fuel_company: row.fuel_company,
              project_key: row.project_key,
              zone: row.zone,
              amount_kwd: row.amount_kwd,
              created_at: row.created_at,
            },
          ]
        : [],
    );
    const overrideByKey = new Map(
      (withdrawnOverrides.data ?? []).map((item) => [`${item.vehicleId}:${item.driverId}`, item.amountKwd]),
    );
    return withFuelRequestRows(fillsOnly, requests, range.days)
      .map((row) => applyWithdrawnOverride(row, overrideByKey.get(`${row.vehicleId}:${row.driverId}`)))
      .filter((row) => fuelWeekMatchesSearch(row, search));
  }, [fills, range.days, range.start, requestRows, search, withdrawnOverrides.data]);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  const applyCustom = () => {
    const next = resolveFuelRange({
      mode: "custom",
      anchor,
      customFrom: draftFrom,
      customTo: draftTo,
    });
    if (!next.ok) {
      setRangeError(next.reason);
      return;
    }
    setRangeError(null);
    setAppliedFrom(draftFrom);
    setAppliedTo(draftTo);
    setCustomOpen(false);
    setMode("custom");
  };
  const shownMode: FuelRangeMode = customOpen ? "custom" : mode;
  const selectMode = (next: Exclude<FuelRangeMode, "custom">) => {
    setCustomOpen(false);
    setRangeError(null);
    setMode(next);
  };

  return (
    <AppPage>
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <AppListCard
        title={t("rangeTitle", {
          from: formatKuwaitDayLabel(range.start),
          to: formatKuwaitDayLabel(range.end),
          count: mounted ? rows.length : 0,
        })}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <ToggleChip selected={shownMode === "daily"} onClick={() => selectMode("daily")} icon={Calendar} className="h-9">
                {t("rangeDaily")}
              </ToggleChip>
              <ToggleChip selected={shownMode === "weekly"} onClick={() => selectMode("weekly")} icon={CalendarDays} className="h-9">
                {t("rangeWeekly")}
              </ToggleChip>
              <ToggleChip selected={shownMode === "monthly"} onClick={() => selectMode("monthly")} icon={CalendarRange} className="h-9">
                {t("rangeMonthly")}
              </ToggleChip>
              <ToggleChip
                selected={shownMode === "custom"}
                onClick={() => setCustomOpen(true)}
                icon={SlidersHorizontal}
                className="h-9"
              >
                {t("rangeCustom")}
              </ToggleChip>
            </div>
            {shownMode === "custom" ? (
              <div className="flex flex-wrap items-center gap-1">
                <Input
                  type="date"
                  aria-label={t("customFrom")}
                  value={draftFrom}
                  onChange={(event) => setDraftFrom(event.target.value)}
                  className="h-9 w-[140px]"
                />
                <Input
                  type="date"
                  aria-label={t("customTo")}
                  value={draftTo}
                  onChange={(event) => setDraftTo(event.target.value)}
                  className="h-9 w-[140px]"
                />
                <Button type="button" className="h-9" onClick={applyCustom}>
                  {t("customApply")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  onClick={() => setAnchor(shiftFuelAnchor(shownMode === "monthly" ? "monthly" : shownMode === "daily" ? "daily" : "weekly", anchor, -1))}
                  aria-label={t("prevRange")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" className="h-9" onClick={() => setAnchor(kuwaitTodayYmd())}>
                  {shownMode === "daily" ? t("thisDay") : shownMode === "monthly" ? t("thisMonth") : t("thisWeek")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  onClick={() => setAnchor(shiftFuelAnchor(shownMode === "monthly" ? "monthly" : shownMode === "daily" ? "daily" : "weekly", anchor, 1))}
                  aria-label={t("nextRange")}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            {rangeError ? (
              <p className="text-[10px] text-destructive">
                {rangeError === "span" ? t("rangeTooLong") : t("rangeOrder")}
              </p>
            ) : null}
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
        ) : rows.length === 0 ? (
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
              ...range.days.map((day) => ({ id: day, label: formatKuwaitDayLabel(day) })),
            ]}
            empty={rows.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {rows.map((row) => (
              <FuelRow
                key={row.key}
                row={row}
                onOpenFill={() => {
                  if (row.fills.length > 0) setSelectedKey(row.key);
                }}
                onOpenRequest={(id) => {
                  const request = requestRows.find((item) => item.id === id);
                  if (request) setSelectedRequest(request);
                }}
                onEditWithdrawn={() => setEditRow(row)}
              />
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <FuelFillDialog
        open={Boolean(selected)}
        row={selected}
        weekDays={range.days}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null);
        }}
      />
      <FleetRequestDialog
        open={Boolean(selectedRequest)}
        type={selectedRequest?.request_type === "fuel_refund" ? "fuel_refund" : "fuel"}
        row={selectedRequest}
        onOpenChange={(open) => {
          if (!open) setSelectedRequest(null);
        }}
      />
      <FuelWithdrawnDialog
        open={Boolean(editRow)}
        row={editRow}
        monthKey={monthKey}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
      />
    </AppPage>
  );
}

function FuelRow({
  row,
  onOpenFill,
  onOpenRequest,
  onEditWithdrawn,
}: {
  row: FuelLogRow;
  onOpenFill: () => void;
  onOpenRequest: (id: string) => void;
  onEditWithdrawn: () => void;
}) {
  const t = useTranslations("pages.fuel");
  const router = useRouter();
  return (
    <AppDataTableRow
      className={row.critical ? "cursor-pointer bg-destructive/10 hover:bg-destructive/15" : "cursor-pointer"}
      onClick={() => router.push(`/fuel/drivers/${row.driverId}`)}
    >
      <TableCell className="whitespace-nowrap">
        <p className="font-medium">{row.driverName ?? "—"}</p>
        {row.employeeId ? <p className="text-[11px] text-muted-foreground">{row.employeeId}</p> : null}
        <Link
          href={`/fuel/drivers/${row.driverId}`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:bg-primary/10"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {t("viewDetails")}
        </Link>
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
      <TableCell className="whitespace-nowrap">
        {row.fills.length === 0 && row.monthlyLimit <= 0 ? "—" : `${formatKwd(row.monthlyLimit)} KWD`}
      </TableCell>
      <TableCell className={row.critical ? "font-semibold text-destructive" : undefined}>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-start text-primary hover:bg-primary/10"
          onClick={(event) => {
            event.stopPropagation();
            onEditWithdrawn();
          }}
        >
          <span>{row.fills.length === 0 && row.withdrawn <= 0 ? "—" : `${formatKwd(row.withdrawn)} KWD`}</span>
          <Pencil className="size-3.5 shrink-0" />
        </button>
        {row.monthlyLimit > 0 ? (
          <div className="mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${row.critical ? "bg-destructive" : "bg-primary"}`}
              style={{ width: `${Math.min(100, (row.withdrawn / row.monthlyLimit) * 100)}%` }}
            />
          </div>
        ) : null}
      </TableCell>
      {row.days.map((cell, index) => {
        const marks = row.dayMarks[index] ?? [];
        return (
          <TableCell key={index} className="whitespace-nowrap">
            <span className="inline-flex flex-col items-start gap-1">
              {cell ? (
                <button
                  type="button"
                  className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenFill();
                  }}
                >
                  {formatKwd(cell.costKwd)}
                </button>
              ) : null}
              {marks.map((mark) => (
                <button
                  key={mark.id}
                  type="button"
                  className={`inline-flex flex-col items-start rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-tight ${FLEET_REQUEST_CHIP_CLASS[mark.type]}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenRequest(mark.id);
                  }}
                >
                  <span>{mark.code}</span>
                  {mark.amountKwd != null ? <span>{formatKwd(mark.amountKwd)}</span> : null}
                </button>
              ))}
              {!cell && marks.length === 0 ? <span className="text-muted-foreground">—</span> : null}
            </span>
          </TableCell>
        );
      })}
    </AppDataTableRow>
  );
}
