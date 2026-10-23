"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppListControls,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
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
  const tCommon = useTranslations("common");
  const labels = useListControlLabels();
  const { prefs, update } = useListViewPrefs(`fleet-${kind}`);
  const [search, setSearch] = useState("");
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
        fieldSearchMatch<FleetLedgerRow>(row, search, {
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
    [rows, search],
  );
  const grouped = useMemo(
    () =>
      groupRows<FleetLedgerRow>(
        filtered,
        prefs.groupBy,
        {
          date: (row) =>
            dayLabel(
              "serviced_at" in row
                ? row.serviced_at
                : "handed_at" in row
                  ? row.handed_at
                  : row.occurred_at,
            ),
          status: (row) => ("severity" in row ? row.severity : "kind" in row ? row.kind : null),
        },
        {},
        "—",
      ),
    [filtered, prefs.groupBy],
  );
  const columns =
    kind === "service"
      ? [
          { id: "plate", label: t("colPlate") },
          { id: "when", label: tDetail("colWhen") },
          { id: "kind", label: tDetail("colKind") },
          { id: "vendor", label: tDetail("colVendor") },
          { id: "odometer", label: tDetail("colOdometer") },
          { id: "cost", label: tDetail("colCost") },
        ]
      : kind === "handover"
        ? [
            { id: "plate", label: t("colPlate") },
            { id: "when", label: tDetail("colWhen") },
            { id: "from", label: tDetail("colFrom") },
            { id: "to", label: tDetail("colTo") },
            { id: "notes", label: tDetail("colNotes") },
          ]
        : [
            { id: "plate", label: t("colPlate") },
            { id: "when", label: tDetail("colWhen") },
            { id: "location", label: tDetail("colLocation") },
            { id: "severity", label: tDetail("colSeverity") },
            { id: "notes", label: tDetail("colNotes") },
          ];

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[{ label: tHub("breadcrumb"), href: "/fleet" }, { label: t("breadcrumb") }]}
        title={t("title")}
        description={t("subtitle")}
      />
      <AppListCard
        toolbar={
          <AppListControls
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={tCommon("search")}
            clearSearchLabel={labels.clearSearch}
            groupByOptions={[labels.group.none, labels.group.date, labels.group.status]}
            groupBy={prefs.groupBy}
            onGroupByChange={(value) => update({ groupBy: value })}
            groupByLabel={labels.groupBy}
          />
        }
      >
        {list.isPending ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <AppDataTable
            columns={columns}
            empty={filtered.length === 0 ? <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty> : null}
          >
            {grouped.flatMap((group) => [
              prefs.groupBy !== "none" ? (
                <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="bg-muted/40 py-2 text-xs font-semibold">
                    {group.label}
                  </TableCell>
                </AppDataTableRow>
              ) : null,
              ...group.rows.map((row) =>
                kind === "service" ? (
                  <LedgerRow
                    key={row.id}
                    href={`/vehicles/${row.vehicle_id}?tab=service`}
                    plate={row.plate}
                    viewLabel={t("viewVehicle")}
                  >
                    <TableCell className="whitespace-nowrap">
                      {dayLabel((row as FleetVehicleServiceRow).serviced_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{(row as FleetVehicleServiceRow).kind || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{(row as FleetVehicleServiceRow).vendor ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{(row as FleetVehicleServiceRow).odometer ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{(row as FleetVehicleServiceRow).cost_kwd ?? "—"}</TableCell>
                  </LedgerRow>
                ) : kind === "handover" ? (
                  <LedgerRow
                    key={row.id}
                    href={`/vehicles/${row.vehicle_id}?tab=handover`}
                    plate={row.plate}
                    viewLabel={t("viewVehicle")}
                  >
                    <TableCell className="whitespace-nowrap">
                      {dayLabel((row as FleetVehicleHandoverRow).handed_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{(row as FleetVehicleHandoverRow).from_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{(row as FleetVehicleHandoverRow).to_name ?? "—"}</TableCell>
                    <TableCell className="min-w-[160px]">{(row as FleetVehicleHandoverRow).notes ?? "—"}</TableCell>
                  </LedgerRow>
                ) : (
                  <LedgerRow
                    key={row.id}
                    href={`/vehicles/${row.vehicle_id}?tab=accident`}
                    plate={row.plate}
                    viewLabel={t("viewVehicle")}
                  >
                    <TableCell className="whitespace-nowrap">
                      {dayLabel((row as FleetVehicleAccidentRow).occurred_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(row as FleetVehicleAccidentRow).location_text ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {severityLabel((row as FleetVehicleAccidentRow).severity, tDetail)}
                    </TableCell>
                    <TableCell className="min-w-[160px]">{(row as FleetVehicleAccidentRow).notes ?? "—"}</TableCell>
                  </LedgerRow>
                ),
              ),
            ])}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}

function LedgerRow({
  href,
  plate,
  viewLabel,
  children,
}: {
  href: string;
  plate: string | null;
  viewLabel: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <AppDataTableRow className="cursor-pointer" onClick={() => router.push(href)}>
      <TableCell className="whitespace-nowrap">
        <p className="font-medium">{plate ?? "—"}</p>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {viewLabel}
        </Link>
      </TableCell>
      {children}
    </AppDataTableRow>
  );
}
