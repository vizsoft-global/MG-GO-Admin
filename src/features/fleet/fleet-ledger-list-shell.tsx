"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  FlatListPager,
  GroupTableHeaderRow,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Link, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import {
  listFleetVehicleAccidents,
  listFleetVehicleHandovers,
  listFleetVehicleServices,
  type FleetVehicleAccidentRow,
  type FleetVehicleHandoverRow,
  type FleetVehicleServiceRow,
} from "@/features/vehicles/vehicle-tabs-actions";

export type FleetLedgerKind = "service" | "handover" | "accident";
type FleetLedgerRow = FleetVehicleServiceRow | FleetVehicleHandoverRow | FleetVehicleAccidentRow;

function dayLabel(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

function ledgerHref(kind: FleetLedgerKind, vehicleId: string): string {
  const tab = kind === "service" ? "service" : kind === "handover" ? "handover" : "accident";
  return `/vehicles/${vehicleId}?tab=${tab}`;
}

function ledgerCell(
  kind: FleetLedgerKind,
  columnId: string,
  row: FleetLedgerRow,
  tDetail: (key: "severity.low" | "severity.medium" | "severity.high") => string,
): ReactNode {
  if (kind === "service" && "serviced_at" in row) {
    switch (columnId) {
      case "when":
        return dayLabel(row.serviced_at);
      case "kind":
        return row.kind ? row.kind : <EmptyCell />;
      case "vendor":
        return row.vendor ? row.vendor : <EmptyCell />;
      case "odometer":
        return row.odometer == null ? <EmptyCell /> : String(row.odometer);
      case "cost":
        return row.cost_kwd == null ? <EmptyCell /> : String(row.cost_kwd);
      default:
        return null;
    }
  }
  if (kind === "handover" && "handed_at" in row) {
    switch (columnId) {
      case "when":
        return dayLabel(row.handed_at);
      case "from":
        return row.from_name ? row.from_name : <EmptyCell />;
      case "to":
        return row.to_name ? row.to_name : <EmptyCell />;
      case "notes":
        return row.notes ? row.notes : <EmptyCell />;
      default:
        return null;
    }
  }
  if (kind === "accident" && "occurred_at" in row) {
    switch (columnId) {
      case "when":
        return dayLabel(row.occurred_at);
      case "location":
        return row.location_text ? row.location_text : <EmptyCell />;
      case "severity":
        return severityLabel(row.severity, tDetail);
      case "notes":
        return row.notes ? row.notes : <EmptyCell />;
      default:
        return null;
    }
  }
  return null;
}

function severityLabel(
  severity: string,
  tDetail: (key: "severity.low" | "severity.medium" | "severity.high") => string,
): string {
  switch (severity) {
    case "low":
      return tDetail("severity.low");
    case "medium":
      return tDetail("severity.medium");
    case "high":
      return tDetail("severity.high");
    default:
      return severity || "—";
  }
}

export function FleetLedgerListShell({ kind }: { kind: FleetLedgerKind }) {
  const tService = useTranslations("pages.fleetService");
  const tHandover = useTranslations("pages.fleetHandover");
  const tAccident = useTranslations("pages.fleetAccident");
  const tHub = useTranslations("pages.fleetHub.hub");
  const tDetail = useTranslations("pages.vehicleDetail");
  const t =
    kind === "service" ? tService : kind === "handover" ? tHandover : tAccident;
  const columns = useMemo<TableToolbarColumn[]>(() => {
    if (kind === "service") {
      return [
        { id: "plate", label: t("colPlate"), locked: true },
        { id: "when", label: tDetail("colWhen"), categorical: true },
        { id: "kind", label: tDetail("colKind"), categorical: true },
        { id: "vendor", label: tDetail("colVendor") },
        { id: "odometer", label: tDetail("colOdometer") },
        { id: "cost", label: tDetail("colCost") },
      ];
    }
    if (kind === "handover") {
      return [
        { id: "plate", label: t("colPlate"), locked: true },
        { id: "when", label: tDetail("colWhen"), categorical: true },
        { id: "from", label: tDetail("colFrom") },
        { id: "to", label: tDetail("colTo") },
        { id: "notes", label: tDetail("colNotes") },
      ];
    }
    return [
      { id: "plate", label: t("colPlate"), locked: true },
      { id: "when", label: tDetail("colWhen"), categorical: true },
      { id: "location", label: tDetail("colLocation") },
      { id: "severity", label: tDetail("colSeverity"), categorical: true },
      { id: "notes", label: tDetail("colNotes") },
    ];
  }, [kind, t, tDetail]);
  const prefs = useTablePrefs(`fleet-${kind}`, columns);
  const list = useQuery<FleetLedgerRow[]>({
    queryKey: queryKeys.vehicles.fleetLedger(kind),
    queryFn: async (): Promise<FleetLedgerRow[]> => {
      switch (kind) {
        case "service":
          return listFleetVehicleServices();
        case "handover":
          return listFleetVehicleHandovers();
        case "accident":
          return listFleetVehicleAccidents();
        default: {
          const _exhaustive: never = kind;
          throw new Error(`unexpected fleet ledger kind: ${String(_exhaustive)}`);
        }
      }
    },
  });
  const rows: FleetLedgerRow[] = list.data ?? [];
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        fieldSearchMatch<FleetLedgerRow>(row, prefs.appliedQuery, {
          plate: (item) => item.plate,
          name: (item) => {
            if ("from_name" in item) return item.from_name;
            if ("vendor" in item) return item.vendor;
            if ("location_text" in item) return item.location_text;
            return null;
          },
          status: (item) => ("severity" in item ? item.severity : "kind" in item ? item.kind : null),
        }),
      ),
    [prefs.appliedQuery, rows],
  );
  const grouped = useMemo(
    () =>
      groupRows<FleetLedgerRow>(
        filtered,
        prefs.groupBy,
        {
          when: (row) =>
            dayLabel(
              "serviced_at" in row
                ? row.serviced_at
                : "handed_at" in row
                  ? row.handed_at
                  : row.occurred_at,
            ),
          kind: (row) => ("kind" in row ? row.kind : null),
          severity: (row) => ("severity" in row ? row.severity : null),
        },
        {},
        "—",
      ),
    [filtered, prefs.groupBy],
  );
  const listView = useGroupedListView(
    grouped,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}`,
  );
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const router = useRouter();

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[{ label: tHub("breadcrumb"), href: "/fleet" }, { label: t("breadcrumb") }]}
        title={t("title")}
        description={t("subtitle")}
      />
      <AppListCard>
        {list.isPending ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : prefs.view === "grid" ? (
          <div>
            <TableToolbar
              prefs={prefs}
              entity={t("title")}
              columns={columns}
              rowKind="dynamic"
              entityList
              filteredCount={filtered.length}
              totalCount={rows.length}
            />
            <TableGridCards
              rows={filtered.map((row) => ({
                id: row.id,
                name: row.plate?.trim() ? row.plate : "",
                fields: shownColumns
                  .filter((column) => column.id !== "plate")
                  .slice(0, 4)
                  .map((column) => ({
                    label: column.label,
                    value: ledgerCell(kind, column.id, row, tDetail),
                  })),
                onOpen: () => router.push(ledgerHref(kind, row.vehicle_id)),
              }))}
            />
          </div>
        ) : (
          <>
          <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
          <AppDataTable
            toolbar={
              <TableToolbar
                prefs={prefs}
                entity={t("title")}
                columns={columns}
                rowKind="dynamic"
                entityList
                filteredCount={filtered.length}
                totalCount={rows.length}
              />
            }
            columns={shownColumns.map((column) => ({ id: column.id, label: column.label }))}
            empty={filtered.length === 0 ? <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty> : null}
          >
            {listView.sections.flatMap((section) => [
              section.showHeader ? (
                <GroupTableHeaderRow
                  key={`g-${section.key}`}
                  colSpan={shownColumns.length}
                  label={section.label}
                  total={section.total}
                  open={section.open}
                  page={section.page}
                  showPager={section.showPager}
                  onToggle={() => listView.toggle(section.key)}
                  onStep={(dir) => listView.step(section.key, dir)}
                />
              ) : null,
              ...section.visibleRows.map((row) => (
                <LedgerRow
                  key={row.id}
                  href={ledgerHref(kind, row.vehicle_id)}
                  plate={row.plate}
                  viewLabel={t("viewVehicle")}
                  showPlate={prefs.isVisible("plate")}
                >
                  {shownColumns
                    .filter((column) => column.id !== "plate")
                    .map((column) => (
                      <TableCell key={column.id} className="whitespace-nowrap">
                        {ledgerCell(kind, column.id, row, tDetail)}
                      </TableCell>
                    ))}
                </LedgerRow>
              )),
            ])}
          </AppDataTable>
          </>
        )}
      </AppListCard>
    </AppPage>
  );
}

function LedgerRow({
  href,
  plate,
  viewLabel,
  showPlate,
  children,
}: {
  href: string;
  plate: string | null;
  viewLabel: string;
  showPlate: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <AppDataTableRow className="cursor-pointer" onClick={() => router.push(href)}>
      {showPlate ? (
        <TableCell className="whitespace-nowrap">
          <TableNameCell name={plate} />
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10"
            onClick={(event) => event.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" />
            {viewLabel}
          </Link>
        </TableCell>
      ) : null}
      {children}
    </AppDataTableRow>
  );
}
