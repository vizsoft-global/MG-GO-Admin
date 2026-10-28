"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "@/i18n/navigation";
import { WrongActionFormDialog } from "./wrong-action-form-dialog";
import { useDriverWrongActions, useWrongActionDriverOptions } from "./use-wrong-actions";
import { formatKuwait, severityTone } from "./wrong-actions-page-shell";
import { wrongActionKpis } from "./wrong-actions-list-utils";

export function DriverWrongActionsTab({ driverId }: { driverId: string }) {
  const t = useTranslations("pages.wrongActions");
  const { can } = useAuth();
  const canManage = can("wrong_actions.manage");
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const { data: rows = [], isLoading, refetch } = useDriverWrongActions(driverId);
  const { data: drivers = [], isLoading: driversLoading } =
    useWrongActionDriverOptions(addOpen);

  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "type", label: t("colType"), locked: true },
    { id: "severity", label: t("colSeverity") },
    { id: "date", label: t("colDate") },
    { id: "source", label: t("colSource") },
    { id: "details", label: t("fieldDetails") },
  ], [t]);
  const prefs = useTablePrefs(`driver-wrong-actions-${driverId}`, columns);
  const now = useMemo(() => new Date(), []);
  const counts = useMemo(() => wrongActionKpis(rows, now), [now, rows]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("title")}</p>
          {!isLoading && rows.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("driverWeightedHint", { count: counts.total, weight: counts.weighted })}
            </p>
          ) : null}
        </div>
        {null}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <AppDataTable
          toolbar={
            <TableToolbar
              prefs={prefs}
              entity={t("title")}
              columns={columns}
              rowKind="dynamic"
              filteredCount={rows.filter((row) => {
                const needle = prefs.appliedQuery.trim().toLowerCase();
                return !needle || `${row.action_type} ${row.severity} ${row.details ?? ""} ${row.source}`.toLowerCase().includes(needle);
              }).length}
              totalCount={rows.length}
              onAdd={canManage ? () => setAddOpen(true) : undefined}
              addLabel={t("addIncident")}
            />
          }
          columns={prefs.orderedColumns.filter((column) => prefs.isVisible(column.id)).map((column) => ({
            id: column.id,
            label: column.label,
          }))}
          empty={
            rows.length === 0 ? (
              <AppDataTableEmpty>{t("noneForDriver")}</AppDataTableEmpty>
            ) : null
          }
        >
          {rows.filter((row) => {
            const needle = prefs.appliedQuery.trim().toLowerCase();
            return !needle || `${row.action_type} ${row.severity} ${row.details ?? ""} ${row.source}`.toLowerCase().includes(needle);
          }).map((row) => (
            <AppDataTableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => router.push(`/wrong-actions/${row.id}`)}
            >
              {prefs.orderedColumns.filter((column) => prefs.isVisible(column.id)).map((column) => {
                if (column.id === "type") {
                  return <TableCell key={column.id}><TableNameCell name={t(`type.${row.action_type}` as "type.delay")} /><p className="text-xs text-primary">{t("viewDetails")}</p></TableCell>;
                }
                if (column.id === "severity") {
                  return <TableCell key={column.id}><Badge variant={severityTone(row.severity)}>{t(`severity.${row.severity}` as "severity.low")}</Badge></TableCell>;
                }
                if (column.id === "date") return <TableCell key={column.id}>{formatKuwait(row.occurred_at)}</TableCell>;
                if (column.id === "source") return <TableCell key={column.id}>{t(`source.${row.source}` as "source.admin")}</TableCell>;
                return <TableCell key={column.id} className="max-w-[280px] truncate">{row.details ? row.details : <EmptyCell />}</TableCell>;
              })}
            </AppDataTableRow>
          ))}
        </AppDataTable>
      )}

      <WrongActionFormDialog
        open={addOpen && canManage}
        incident={null}
        drivers={drivers}
        driversLoading={driversLoading}
        lockedDriverId={driverId}
        onOpenChange={setAddOpen}
        onSaved={() => {
          setAddOpen(false);
          void refetch();
        }}
      />
    </div>
  );
}
