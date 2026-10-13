"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
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
  const list = useQuery<FleetLedgerRow[]>({
    queryKey: queryKeys.vehicles.fleetLedger(kind),
    queryFn: () => {
      switch (kind) {
        case "service":
          return listFleetVehicleServices();
        case "handover":
          return listFleetVehicleHandovers();
        case "accident":
          return listFleetVehicleAccidents();
        default: {
          const _exhaustive: never = kind;
          return _exhaustive;
        }
      }
    },
  });
  const rows = list.data ?? [];
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
      <AppListCard>
        {list.isPending ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <AppDataTable
            columns={columns}
            empty={rows.length === 0 ? <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty> : null}
          >
            {kind === "service"
              ? (rows as FleetVehicleServiceRow[]).map((row) => (
                  <LedgerRow
                    key={row.id}
                    href={`/vehicles/${row.vehicle_id}?tab=service`}
                    plate={row.plate}
                    viewLabel={t("viewVehicle")}
                  >
                    <TableCell className="whitespace-nowrap">{dayLabel(row.serviced_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.kind || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.vendor ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.odometer ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{row.cost_kwd ?? "—"}</TableCell>
                  </LedgerRow>
                ))
              : kind === "handover"
                ? (rows as FleetVehicleHandoverRow[]).map((row) => (
                    <LedgerRow
                      key={row.id}
                      href={`/vehicles/${row.vehicle_id}?tab=handover`}
                      plate={row.plate}
                      viewLabel={t("viewVehicle")}
                    >
                      <TableCell className="whitespace-nowrap">{dayLabel(row.handed_at)}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.from_name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.to_name ?? "—"}</TableCell>
                      <TableCell className="min-w-[160px]">{row.notes ?? "—"}</TableCell>
                    </LedgerRow>
                  ))
                : (rows as FleetVehicleAccidentRow[]).map((row) => (
                    <LedgerRow
                      key={row.id}
                      href={`/vehicles/${row.vehicle_id}?tab=accident`}
                      plate={row.plate}
                      viewLabel={t("viewVehicle")}
                    >
                      <TableCell className="whitespace-nowrap">{dayLabel(row.occurred_at)}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.location_text ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {severityLabel(row.severity, tDetail)}
                      </TableCell>
                      <TableCell className="min-w-[160px]">{row.notes ?? "—"}</TableCell>
                    </LedgerRow>
                  ))}
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
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:bg-primary/10"
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
