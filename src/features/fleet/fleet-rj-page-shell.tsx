"use client";

import { useMemo, useState } from "react";
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
import { StatusPill } from "@/components/dashboard/status-pill";
import { useAuth } from "@/contexts/auth-context";
import { FleetRequestDialog } from "@/features/fuel/fleet-request-dialog";
import type { FleetRequestListRow } from "@/features/fuel/fleet-request-types";
import { useFleetRequests } from "@/features/fuel/use-fleet-requests";
import { toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { requestStatusLabelKey, requestStatusVariant } from "@/features/requests/request-status-utils";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";

function typeLabel(
  type: FleetRequestListRow["request_type"],
  tQueue: (key: "typeFuel" | "typeRefund" | "typeAsset") => string,
): string {
  switch (type) {
    case "fuel":
      return tQueue("typeFuel");
    case "fuel_refund":
      return tQueue("typeRefund");
    case "asset":
      return tQueue("typeAsset");
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function FleetRjPageShell() {
  const t = useTranslations("pages.fleetRj");
  const tHub = useTranslations("pages.fleetHub.hub");
  const tQueue = useTranslations("pages.fleetFuelQueue");
  const statusT = useTranslations("pages.requests.status");
  const { can } = useAuth();
  const canFuel = can("fuel.view") || can("fuel_requests.view");
  const canRefund = can("fuel.view") || can("fuel_refunds.view");
  const canAsset = can("asset_requests.view");
  const fuel = useFleetRequests("fuel");
  const refund = useFleetRequests("fuel_refund");
  const asset = useFleetRequests("asset");
  const [selected, setSelected] = useState<FleetRequestListRow | null>(null);

  const rows = useMemo(() => {
    const listed: FleetRequestListRow[] = [];
    if (canFuel) listed.push(...(fuel.data?.rows ?? []));
    if (canRefund) listed.push(...(refund.data?.rows ?? []));
    if (canAsset) listed.push(...(asset.data?.rows ?? []));
    return listed
      .filter((row) => row.status === "rejected")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [asset.data, canAsset, canFuel, canRefund, fuel.data, refund.data]);

  const isPending =
    (canFuel && fuel.data === undefined && fuel.isPending) ||
    (canRefund && refund.data === undefined && refund.isPending) ||
    (canAsset && asset.data === undefined && asset.isPending);

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={[{ label: tHub("breadcrumb"), href: "/fleet" }, { label: t("breadcrumb") }]}
        title={t("title")}
        description={t("subtitle")}
      />
      <AppListCard>
        {isPending ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: tQueue("colRequestId") },
              { id: "type", label: t("colType") },
              { id: "driver", label: tQueue("colDriver") },
              { id: "plate", label: tQueue("colPlate") },
              { id: "status", label: tQueue("colStatus") },
              { id: "date", label: tQueue("colDate") },
              { id: "actions", label: tQueue("colActions") },
            ]}
            empty={rows.length === 0 ? <AppDataTableEmpty>{tQueue("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => setSelected(row)}
              >
                <TableCell className="whitespace-nowrap font-medium">{row.request_code}</TableCell>
                <TableCell className="whitespace-nowrap">{typeLabel(row.request_type, tQueue)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <p className="font-medium">{row.driver_name}</p>
                  {row.employee_id ? (
                    <p className="text-[11px] text-muted-foreground">{row.employee_id}</p>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.plate ?? "—"}</TableCell>
                <TableCell>
                  <StatusPill dot variant={requestStatusVariant(row.status)}>
                    {statusT(requestStatusLabelKey(row.status) as "pending")}
                  </StatusPill>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatKuwaitDayLabel(toKuwaitYmd(row.created_at))}
                </TableCell>
                <TableCell className="w-[1%] whitespace-nowrap">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-1 text-primary hover:bg-primary/10"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(row);
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {tQueue("open")}
                  </button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <FleetRequestDialog
        open={Boolean(selected)}
        type={selected?.request_type === "fuel_refund" ? "fuel_refund" : selected?.request_type === "asset" ? "asset" : "fuel"}
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </AppPage>
  );
}
