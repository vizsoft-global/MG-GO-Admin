"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, Search } from "lucide-react";
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
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  DepartmentBadge,
  FuelCompanyBadge,
  HadBeforeBadge,
  ProjectBadge,
} from "@/features/fleet/fleet-badges";
import { isDriverProjectKey, toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { Link } from "@/i18n/navigation";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";
import { requestStatusLabelKey, requestStatusVariant } from "@/features/requests/request-status-utils";
import { FleetRequestDialog } from "./fleet-request-dialog";
import { fleetRequestMatchesSearch, type FleetQueueRequestType } from "./fleet-request-utils";
import { formatKwd } from "./fuel-week";
import { useFleetRequests } from "./use-fleet-requests";
import type { FleetRequestListRow } from "./fleet-request-types";

export function FleetRequestPageShell({ type }: { type: FleetQueueRequestType }) {
  const t = useTranslations("pages.fleetFuelQueue");
  const statusT = useTranslations("pages.requests.status");
  const { data, isPending } = useFleetRequests(type);
  const rows = data?.rows ?? [];
  const isLoading = data === undefined || isPending;
  const [search, setSearch] = useState("");
  const [projectKey, setProjectKey] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isAsset = type === "asset";

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (!fleetRequestMatchesSearch(row, search)) return false;
        if (projectKey !== "all" && isDriverProjectKey(projectKey)) {
          return row.project_key === projectKey;
        }
        return true;
      }),
    [projectKey, rows, search],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <AppPage>
      <AppPageHeader
        title={type === "fuel" ? t("requestsTitle") : type === "fuel_refund" ? t("refundsTitle") : t("assetsTitle")}
        description={
          type === "fuel"
            ? t("requestsSubtitle")
            : type === "fuel_refund"
              ? t("refundsSubtitle")
              : t("assetsSubtitle")
        }
      />
      <AppListCard
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("searchPlaceholder")}
                className="h-9 rounded-lg bg-background ps-9"
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
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={type === "fuel" ? t("emptyRequests") : type === "fuel_refund" ? t("emptyRefunds") : t("emptyAssets")}
            description={isAsset ? t("emptyAssetsHint") : t("emptyHint")}
          />
        ) : (
          <AppDataTable
            columns={
              isAsset
                ? [
                    { id: "code", label: t("colRequestId") },
                    { id: "driver", label: t("colEmployee") },
                    { id: "empCompany", label: t("colEmployeeCompany") },
                    { id: "plate", label: t("colPlate") },
                    { id: "vehCompany", label: t("colVehicleCompany") },
                    { id: "project", label: t("colProject") },
                    { id: "zone", label: t("colZone") },
                    { id: "item", label: t("colItem") },
                    { id: "qty", label: t("colQty") },
                    { id: "had", label: t("colHadBefore") },
                    { id: "status", label: t("colStatus") },
                    { id: "step", label: t("colStep") },
                    { id: "date", label: t("colDate") },
                    { id: "actions", label: t("colActions") },
                  ]
                : [
                    { id: "code", label: t("colRequestId") },
                    { id: "driver", label: t("colDriver") },
                    { id: "empCompany", label: t("colEmpCompany") },
                    { id: "vehCompany", label: t("colVehicleCompany") },
                    { id: "fuelCompany", label: t("colFuelCompany") },
                    { id: "project", label: t("colProject") },
                    { id: "zone", label: t("colZone") },
                    { id: "department", label: t("colDepartment") },
                    type === "fuel"
                      ? { id: "requestNo", label: t("colRequestNo") }
                      : { id: "amount", label: t("colAmount") },
                    { id: "status", label: t("colStatus") },
                    { id: "step", label: t("colStep") },
                    { id: "date", label: t("colDate") },
                    { id: "actions", label: t("colActions") },
                  ]
            }
            empty={visible.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {visible.map((row) => (
              <FleetRequestRow
                key={row.id}
                row={row}
                type={type}
                statusLabel={statusT(requestStatusLabelKey(row.status) as "pending")}
                onOpen={() => setSelectedId(row.id)}
              />
            ))}
          </AppDataTable>
        )}
      </AppListCard>
      <FleetRequestDialog
        open={Boolean(selected)}
        type={type}
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </AppPage>
  );
}

function FleetRequestRow({
  row,
  type,
  statusLabel,
  onOpen,
}: {
  row: FleetRequestListRow;
  type: FleetQueueRequestType;
  statusLabel: string;
  onOpen: () => void;
}) {
  const t = useTranslations("pages.fleetFuelQueue");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="whitespace-nowrap font-medium">{row.request_code}</TableCell>
      <TableCell className="whitespace-nowrap">
        <p className="font-medium">{row.driver_name}</p>
        {row.employee_id ? <p className="text-[11px] text-muted-foreground">{row.employee_id}</p> : null}
        <Link
          href={`/requests/${row.id}`}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:bg-primary/10"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {t("viewDetails")}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.employee_company ?? "—"}</TableCell>
      {type === "asset" ? (
        <TableCell className="whitespace-nowrap font-medium">{row.plate ?? "—"}</TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap">{row.vehicle_company ?? "—"}</TableCell>
      {type === "asset" ? null : (
        <TableCell>
          <FuelCompanyBadge value={row.fuel_company} />
        </TableCell>
      )}
      <TableCell>
        <ProjectBadge value={row.project_key} />
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.zone ?? "—"}</TableCell>
      {type === "asset" ? (
        <>
          <TableCell className="whitespace-nowrap">{row.item ?? "—"}</TableCell>
          <TableCell className="whitespace-nowrap">{row.quantity ?? "—"}</TableCell>
          <TableCell>
            <HadBeforeBadge value={row.had_before} />
          </TableCell>
        </>
      ) : (
        <>
          <TableCell>
            <DepartmentBadge value={row.department} />
          </TableCell>
          <TableCell className="whitespace-nowrap">
            {type === "fuel" ? row.request_no_this_month : `${formatKwd(row.amount_kwd ?? 0)} KWD`}
          </TableCell>
        </>
      )}
      <TableCell>
        <StatusPill dot variant={requestStatusVariant(row.status)}>
          {statusLabel}
        </StatusPill>
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.current_step_label ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{formatKuwaitDayLabel(toKuwaitYmd(row.created_at))}</TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          className="h-9 text-primary hover:bg-primary/10"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ExternalLink className="me-1.5 h-3.5 w-3.5" />
          {t("open")}
        </Button>
      </TableCell>
    </AppDataTableRow>
  );
}
