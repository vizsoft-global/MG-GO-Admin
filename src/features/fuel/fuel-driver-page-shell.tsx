"use client";

import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
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
import { useFleetBreadcrumbs } from "@/features/fleet/use-fleet-breadcrumbs";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { fieldSearchMatch } from "@/components/app/app-list-controls";
import {
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { ProjectBadge } from "@/features/fleet/fleet-badges";
import { fuelPaymentLabel, toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { requestStatusLabelKey, requestStatusVariant } from "@/features/requests/request-status-utils";
import { useRouter } from "@/i18n/navigation";
import { formatKuwaitDateLabel, formatKuwaitDayLabel, kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
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
  const withHub = useFleetBreadcrumbs();
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
  // Without this the month arrows were changing the query but nothing on screen
  // said which month was showing, so a correct move to a quiet month read as
  // "the arrow does nothing" — an empty table with no explanation.
  const rangeTitle =
    range.start === range.end
      ? formatKuwaitDateLabel(range.start)
      : `${formatKuwaitDateLabel(range.start)} – ${formatKuwaitDateLabel(range.end)}`;
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

  // A functional update, because two quick clicks used to read the same
  // `anchor` and land one month short. `stopPropagation` keeps the click off
  // anything the toolbar sits above; the arrow is a range control, not a
  // navigation.
  const shiftMonthlyRange =
    (direction: -1 | 1) => (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setRangeError(null);
      setAnchor((prev) => shiftFuelAnchor("monthly", prev, direction));
    };

  const resetToThisMonth = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setRangeError(null);
    setAnchor(kuwaitTodayYmd());
  };

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
  // An RPC refusal and a genuinely empty month used to paint the same empty
  // state, which is how a broken query stayed invisible behind "no rows".
  const requestError = tab === "fuel" ? fuelRequests.isError : refundRequests.isError;

  return (
    <AppPage>
      <AppPageHeader
        title={driverName}
        description={[employeeId, plate, zone].filter(Boolean).join(" · ") || t("driver.subtitle")}
        breadcrumbs={[...withHub({ label: t("title"), href: "/fuel" }), { label: driverName }]}
        actions={
          <div className="flex items-center gap-2">
            <ProjectBadge value={projectKey} />
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-1.5"
              onClick={() => router.push("/fuel")}
            >
              <ArrowLeft className="h-4 w-4" />
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
        title={rangeTitle}
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
                  onClick={shiftMonthlyRange(-1)}
                  aria-label={t("prevRange")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" className="h-9" onClick={resetToThisMonth}>
                  {t("thisMonth")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-9 p-0"
                  onClick={shiftMonthlyRange(1)}
                  aria-label={t("nextRange")}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            {rangeError ? (
              <p className="text-xs text-destructive">
                {rangeError === "span" ? t("rangeTooLong") : t("rangeOrder")}
              </p>
            ) : null}
          </div>
        }
      >
        <FuelDriverRecords
          key={tab}
          tab={tab}
          fills={fills}
          fillsLoading={loading}
          fillsError={fillsQuery.isError}
          fuelType={fuelType}
          requestRows={requestRows}
          requestLoading={requestLoading}
          requestError={requestError}
          onOpenFill={(row) => {
            const key = row.attachments[0]?.storage_key;
            if (key) void openAttachment(key);
          }}
          onSelectRequest={setSelectedRequest}
        />
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

type FillColumnId = "date" | "station" | "litres" | "kwd" | "payment" | "attachments";
type RequestColumnId = "code" | "date" | "amount" | "status" | "payment";

function isFillColumn(id: string): id is FillColumnId {
  switch (id) {
    case "date":
    case "station":
    case "litres":
    case "kwd":
    case "payment":
    case "attachments":
      return true;
    default:
      return false;
  }
}

function isRequestColumn(id: string): id is RequestColumnId {
  switch (id) {
    case "code":
    case "date":
    case "amount":
    case "status":
    case "payment":
      return true;
    default:
      return false;
  }
}

function recordsEntity(
  tab: DriverFuelTab,
  labels: { transactions: string; fuel: string; refunds: string },
): string {
  switch (tab) {
    case "transactions":
      return labels.transactions;
    case "fuel":
      return labels.fuel;
    case "fuel_refund":
      return labels.refunds;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

function FuelDriverRecords({
  tab,
  fills,
  fillsLoading,
  fillsError,
  fuelType,
  requestRows,
  requestLoading,
  requestError,
  onOpenFill,
  onSelectRequest,
}: {
  tab: DriverFuelTab;
  fills: FuelFillListItem[];
  fillsLoading: boolean;
  fillsError: boolean;
  fuelType: FuelFillListItem["fuel_type"];
  requestRows: FleetRequestListRow[];
  requestLoading: boolean;
  requestError: boolean;
  onOpenFill: (row: FuelFillListItem) => void;
  onSelectRequest: (row: FleetRequestListRow) => void;
}) {
  const t = useTranslations("pages.fuel");
  const statusT = useTranslations("pages.requests.status");
  const columns = useMemo<TableToolbarColumn[]>(() => {
    switch (tab) {
      case "transactions":
        return [
          { id: "date", label: t("driver.colDate"), locked: true },
          { id: "station", label: t("driver.colStation") },
          { id: "litres", label: t("driver.colLitres") },
          { id: "kwd", label: t("driver.colKwd") },
          { id: "payment", label: t("paymentMethod") },
          { id: "attachments", label: t("driver.colAttachments") },
        ];
      case "fuel":
      case "fuel_refund":
        return [
          { id: "code", label: t("driver.colCode"), locked: true },
          { id: "date", label: t("driver.colDate") },
          { id: "amount", label: t("driver.colKwd") },
          { id: "status", label: t("driver.colStatus") },
          { id: "payment", label: t("paymentMethod") },
        ];
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  }, [t, tab]);
  const prefs = useTablePrefs("fuel-driver", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const visibleFills = useMemo(
    () =>
      fills.filter((row) =>
        fieldSearchMatch(row, prefs.appliedQuery, {
          date: (item) => formatKuwaitDayLabel(item.ymd),
          station: (item) => item.station_name,
          litres: (item) => item.litres.toFixed(1),
          kwd: (item) => formatKwd(item.cost_kwd),
          payment: (item) => fuelPaymentLabel(item.fuel_type ?? fuelType) ?? "",
          attachments: (item) =>
            item.attachments.length > 0
              ? t("driver.attachmentCount", { count: item.attachments.length })
              : "",
        }),
      ),
    [fills, fuelType, prefs.appliedQuery, t],
  );
  const visibleRequests = useMemo(
    () =>
      requestRows.filter((row) =>
        fieldSearchMatch(row, prefs.appliedQuery, {
          code: (item) => item.request_code,
          date: (item) => formatKuwaitDayLabel(toKuwaitYmd(item.created_at)),
          amount: (item) => (item.amount_kwd != null ? formatKwd(item.amount_kwd) : ""),
          status: (item) => statusT(requestStatusLabelKey(item.status) as "pending"),
          payment: (item) => fuelPaymentLabel(item.fuel_transfer_type) ?? "",
        }),
      ),
    [prefs.appliedQuery, requestRows, statusT],
  );
  const entity = recordsEntity(tab, {
    transactions: t("driver.tabTransactions"),
    fuel: t("driver.tabRequests"),
    refunds: t("driver.tabRefunds"),
  });
  const filteredCount = tab === "transactions" ? visibleFills.length : visibleRequests.length;
  const totalCount = tab === "transactions" ? fills.length : requestRows.length;

  return (
    <>
      <div className="border-b border-border">
        <TableToolbar
          prefs={prefs}
          entity={entity}
          columns={columns}
          rowKind="dynamic"
          filteredCount={filteredCount}
          totalCount={totalCount}
        />
      </div>
      {tab === "transactions" ? (
        fillsLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : fillsError ? (
          <AppEmptyState title={t("driver.loadFailed")} description={t("driver.loadFailedHint")} />
        ) : fills.length === 0 ? (
          <AppEmptyState title={t("driver.emptyFills")} description={t("driver.emptyFillsHint")} />
        ) : (
          <AppDataTable
            columns={shown.map((column) => ({ id: column.id, label: column.label }))}
            empty={visibleFills.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {visibleFills.map((row) => (
              <FillRow
                key={row.id}
                row={row}
                columns={shown}
                payment={fuelPaymentLabel(row.fuel_type ?? fuelType) ?? "—"}
                onOpenAttachment={() => onOpenFill(row)}
              />
            ))}
          </AppDataTable>
        )
      ) : requestLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : requestError ? (
        <AppEmptyState title={t("driver.loadFailed")} description={t("driver.loadFailedHint")} />
      ) : requestRows.length === 0 ? (
        <AppEmptyState
          title={tab === "fuel" ? t("driver.emptyRequests") : t("driver.emptyRefunds")}
          description={t("driver.emptyRequestsHint")}
        />
      ) : (
        <AppDataTable
          columns={shown.map((column) => ({ id: column.id, label: column.label }))}
          empty={visibleRequests.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
        >
          {visibleRequests.map((row) => (
            <AppDataTableRow key={row.id} className="cursor-pointer" onClick={() => onSelectRequest(row)}>
              {shown.map((column) => {
                if (!isRequestColumn(column.id)) return null;
                const statusLabel = statusT(requestStatusLabelKey(row.status) as "pending");
                return (
                  <TableCell
                    key={column.id}
                    className={column.id === "status" ? undefined : "whitespace-nowrap"}
                  >
                    {requestColumnValue(column.id, row, statusLabel)}
                  </TableCell>
                );
              })}
            </AppDataTableRow>
          ))}
        </AppDataTable>
      )}
    </>
  );
}

function requestColumnValue(id: RequestColumnId, row: FleetRequestListRow, statusLabel: string): ReactNode {
  switch (id) {
    case "code":
      return <span className="font-medium">{row.request_code}</span>;
    case "date":
      return formatKuwaitDayLabel(toKuwaitYmd(row.created_at));
    case "amount":
      return row.amount_kwd != null ? `${formatKwd(row.amount_kwd)} KWD` : "—";
    case "status":
      return (
        <StatusPill dot variant={requestStatusVariant(row.status)}>
          {statusLabel}
        </StatusPill>
      );
    case "payment":
      return fuelPaymentLabel(row.fuel_transfer_type) ?? "—";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function fillColumnValue(id: FillColumnId, row: FuelFillListItem, payment: string, attachmentLabel: string): ReactNode {
  switch (id) {
    case "date":
      return formatKuwaitDayLabel(row.ymd);
    case "station":
      return row.station_name || "—";
    case "litres":
      return row.litres.toFixed(1);
    case "kwd":
      return `${formatKwd(row.cost_kwd)} KWD`;
    case "payment":
      return payment;
    case "attachments":
      return attachmentLabel;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function FillRow({
  row,
  payment,
  columns,
  onOpenAttachment,
}: {
  row: FuelFillListItem;
  payment: string;
  columns: TableToolbarColumn[];
  onOpenAttachment: () => void;
}) {
  const t = useTranslations("pages.fuel");
  const attachmentLabel =
    row.attachments.length > 0 ? t("driver.attachmentCount", { count: row.attachments.length }) : "—";
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpenAttachment}>
      {columns.map((column) => {
        if (!isFillColumn(column.id)) return null;
        return (
          <TableCell
            key={column.id}
            className={
              column.id === "attachments"
                ? "whitespace-nowrap text-muted-foreground"
                : "whitespace-nowrap"
            }
          >
            {fillColumnValue(column.id, row, payment, attachmentLabel)}
          </TableCell>
        );
      })}
    </AppDataTableRow>
  );
}
