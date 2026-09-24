"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Fuel,
  Loader2,
  ReceiptText,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
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
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { ProjectBadge } from "@/features/fleet/fleet-badges";
import { fuelPaymentLabel, toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { requestStatusLabelKey, requestStatusVariant } from "@/features/requests/request-status-utils";
import { useRouter } from "@/i18n/navigation";
import { formatKuwaitDayLabel, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { toast } from "sonner";
import { FleetRequestDialog } from "./fleet-request-dialog";
import { fetchFuelFillAttachmentUrl } from "./fuel-actions";
import { resolveFuelRange, shiftFuelAnchor, type FuelRangeMode } from "./fuel-range";
import { applyWithdrawnOverride, formatKwd } from "./fuel-week";
import type { FleetRequestListRow } from "./fleet-request-types";
import type { FuelFillListItem } from "./types";
import { useFleetRequests } from "./use-fleet-requests";
import { useFuelDriverHeader, useFuelFills, useFuelWithdrawnOverrides } from "./use-fuel";

type DriverFuelTab = "transactions" | "fuel" | "fuel_refund";

export function FuelDriverPageShell({ driverId }: { driverId: string }) {
  const t = useTranslations("pages.fuel");
  const statusT = useTranslations("pages.requests.status");
  const router = useRouter();
  const [mode, setMode] = useState<FuelRangeMode>("monthly");
  const [customOpen, setCustomOpen] = useState(false);
  const [anchor, setAnchor] = useState(kuwaitTodayYmd());
  const [draftFrom, setDraftFrom] = useState(kuwaitTodayYmd());
  const [draftTo, setDraftTo] = useState(kuwaitTodayYmd());
  const [appliedFrom, setAppliedFrom] = useState(kuwaitTodayYmd());
  const [appliedTo, setAppliedTo] = useState(kuwaitTodayYmd());
  const [rangeError, setRangeError] = useState<"order" | "span" | null>(null);
  const [tab, setTab] = useState<DriverFuelTab>("transactions");
  const [selectedRequest, setSelectedRequest] = useState<FleetRequestListRow | null>(null);

  const resolved = useMemo(
    () => resolveFuelRange({ mode, anchor, customFrom: appliedFrom, customTo: appliedTo }),
    [anchor, appliedFrom, appliedTo, mode],
  );
  const range = resolved.ok ? resolved.range : { start: anchor, end: anchor, days: [anchor] };
  const headerQuery = useFuelDriverHeader(driverId);
  const fillsQuery = useFuelFills({ from: range.start, to: range.end, driverId });
  const fuelRequests = useFleetRequests("fuel", driverId);
  const refundRequests = useFleetRequests("fuel_refund", driverId);
  const monthKey = range.start.slice(0, 7);
  const withdrawnOverrides = useFuelWithdrawnOverrides(monthKey);

  const fills = fillsQuery.data ?? [];
  const header = headerQuery.data ?? null;
  const firstFill = fills[0] ?? null;
  const monthlyLimit = firstFill?.fuel_monthly_limit_kwd ?? header?.monthlyLimit ?? 0;
  const fillTotal = fills.reduce((sum, row) => sum + row.cost_kwd, 0);
  const override = (withdrawnOverrides.data ?? []).find((item) => item.driverId === driverId)?.amountKwd;
  const kpiRow = applyWithdrawnOverride(
    { withdrawn: fillTotal, monthlyLimit, critical: false },
    override,
  );
  const remaining = Math.max(0, monthlyLimit - kpiRow.withdrawn);
  const driverName = header?.driverName ?? firstFill?.driver_name ?? t("driver.unknown");
  const employeeId = header?.employeeId ?? firstFill?.employee_id;
  const plate = header?.plate ?? firstFill?.plate;
  const projectKey = header?.projectKey ?? firstFill?.project_key;
  const zone = header?.zone ?? firstFill?.zone_name;
  const fuelType = header?.fuelType ?? firstFill?.fuel_type ?? null;

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

  const openAttachment = async (storageKey: string) => {
    const result = await fetchFuelFillAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? t("driver.openFailed"));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const loading = headerQuery.isPending || fillsQuery.isPending;
  const requestRows = tab === "fuel" ? (fuelRequests.data?.rows ?? []) : refundRequests.data?.rows ?? [];
  const requestLoading = tab === "fuel" ? fuelRequests.isPending : refundRequests.isPending;

  return (
    <AppPage>
      <AppPageHeader
        title={driverName}
        description={[employeeId, plate, zone].filter(Boolean).join(" · ") || t("driver.subtitle")}
        breadcrumbs={[{ label: t("title"), href: "/fuel" }, { label: driverName }]}
        actions={
          <div className="flex items-center gap-2">
            <ProjectBadge value={projectKey} />
            <Button type="button" variant="outline" className="h-9" onClick={() => router.push("/fuel")}>
              {t("driver.back")}
            </Button>
          </div>
        }
      />
      <KpiGrid
        compact
        items={[
          { label: t("monthlyLimit"), value: `${formatKwd(monthlyLimit)} KWD`, icon: Wallet },
          {
            label: t("withdrawn"),
            value: `${formatKwd(kpiRow.withdrawn)} KWD`,
            icon: Fuel,
            accent: kpiRow.critical ? "danger" : undefined,
          },
          { label: t("remaining"), value: `${formatKwd(remaining)} KWD`, icon: Wallet },
          { label: t("driver.fills"), value: String(fills.length), icon: CalendarRange },
        ]}
      />
      <AppListCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleChip
              selected={tab === "transactions"}
              onClick={() => setTab("transactions")}
              icon={Fuel}
              className="h-9"
            >
              {t("driver.tabTransactions")}
            </ToggleChip>
            <ToggleChip
              selected={tab === "fuel"}
              onClick={() => setTab("fuel")}
              icon={ReceiptText}
              className="h-9"
            >
              {t("driver.tabRequests")}
            </ToggleChip>
            <ToggleChip
              selected={tab === "fuel_refund"}
              onClick={() => setTab("fuel_refund")}
              icon={ReceiptText}
              className="h-9"
            >
              {t("driver.tabRefunds")}
            </ToggleChip>
            <ToggleChip
              selected={shownMode === "monthly" && !customOpen}
              onClick={() => {
                setCustomOpen(false);
                setRangeError(null);
                setMode("monthly");
              }}
              icon={CalendarRange}
              className="h-9"
            >
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
                  onClick={() => setAnchor(shiftFuelAnchor("monthly", anchor, -1))}
                  aria-label={t("prevRange")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" className="h-9" onClick={() => setAnchor(kuwaitTodayYmd())}>
                  {t("thisMonth")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  onClick={() => setAnchor(shiftFuelAnchor("monthly", anchor, 1))}
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
          </div>
        }
      >
        {tab === "transactions" ? (
          loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : fills.length === 0 ? (
            <AppEmptyState title={t("driver.emptyFills")} description={t("driver.emptyFillsHint")} />
          ) : (
            <AppDataTable
              columns={[
                { id: "date", label: t("driver.colDate") },
                { id: "station", label: t("driver.colStation") },
                { id: "litres", label: t("driver.colLitres") },
                { id: "kwd", label: t("driver.colKwd") },
                { id: "payment", label: t("paymentMethod") },
                { id: "attachments", label: t("driver.colAttachments") },
              ]}
            >
              {fills.map((row) => (
                <FillRow
                  key={row.id}
                  row={row}
                  payment={fuelPaymentLabel(row.fuel_type ?? fuelType) ?? "—"}
                  onOpenAttachment={() => {
                    const key = row.attachments[0]?.storage_key;
                    if (key) void openAttachment(key);
                  }}
                />
              ))}
            </AppDataTable>
          )
        ) : requestLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : requestRows.length === 0 ? (
          <AppEmptyState
            title={tab === "fuel" ? t("driver.emptyRequests") : t("driver.emptyRefunds")}
            description={t("driver.emptyRequestsHint")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("driver.colCode") },
              { id: "date", label: t("driver.colDate") },
              { id: "amount", label: t("driver.colKwd") },
              { id: "status", label: t("driver.colStatus") },
              { id: "payment", label: t("paymentMethod") },
            ]}
            empty={requestRows.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {requestRows.map((row) => (
              <AppDataTableRow key={row.id} className="cursor-pointer" onClick={() => setSelectedRequest(row)}>
                <TableCell className="whitespace-nowrap font-medium">{row.request_code}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatKuwaitDayLabel(toKuwaitYmd(row.created_at))}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.amount_kwd != null ? `${formatKwd(row.amount_kwd)} KWD` : "—"}
                </TableCell>
                <TableCell>
                  <StatusPill dot variant={requestStatusVariant(row.status)}>
                    {statusT(requestStatusLabelKey(row.status) as "pending")}
                  </StatusPill>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {fuelPaymentLabel(row.fuel_transfer_type) ?? "—"}
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <FleetRequestDialog
        open={Boolean(selectedRequest)}
        type={selectedRequest?.request_type === "fuel_refund" ? "fuel_refund" : "fuel"}
        row={selectedRequest}
        onOpenChange={(open) => {
          if (!open) setSelectedRequest(null);
        }}
      />
    </AppPage>
  );
}

function FillRow({
  row,
  payment,
  onOpenAttachment,
}: {
  row: FuelFillListItem;
  payment: string;
  onOpenAttachment: () => void;
}) {
  const t = useTranslations("pages.fuel");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpenAttachment}>
      <TableCell className="whitespace-nowrap">{formatKuwaitDayLabel(row.ymd)}</TableCell>
      <TableCell className="whitespace-nowrap">{row.station_name || "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{row.litres.toFixed(1)}</TableCell>
      <TableCell className="whitespace-nowrap">{`${formatKwd(row.cost_kwd)} KWD`}</TableCell>
      <TableCell className="whitespace-nowrap">{payment}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {row.attachments.length > 0 ? t("driver.attachmentCount", { count: row.attachments.length }) : "—"}
      </TableCell>
    </AppDataTableRow>
  );
}
