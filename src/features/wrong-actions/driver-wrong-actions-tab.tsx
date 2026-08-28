"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  const now = useMemo(() => new Date(), []);
  const counts = useMemo(() => wrongActionKpis(rows, now), [now, rows]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("title")}</p>
          {!isLoading && rows.length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t("driverWeightedHint", { count: counts.total, weight: counts.weighted })}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <Button
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="me-2 h-3.5 w-3.5" />
            {t("addIncident")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <AppDataTable
          columns={[
            { id: "type", label: t("colType") },
            { id: "severity", label: t("colSeverity") },
            { id: "date", label: t("colDate") },
            { id: "source", label: t("colSource") },
            { id: "details", label: t("fieldDetails") },
          ]}
          empty={
            rows.length === 0 ? (
              <AppDataTableEmpty>{t("noneForDriver")}</AppDataTableEmpty>
            ) : null
          }
        >
          {rows.map((row) => (
            <AppDataTableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => router.push(`/wrong-actions/${row.id}`)}
            >
              <TableCell>
                <p className="font-medium">{t(`type.${row.action_type}` as "type.delay")}</p>
                <p className="text-[11px] text-primary">{t("viewDetails")}</p>
              </TableCell>
              <TableCell>
                <Badge variant={severityTone(row.severity)}>
                  {t(`severity.${row.severity}` as "severity.low")}
                </Badge>
              </TableCell>
              <TableCell>{formatKuwait(row.occurred_at)}</TableCell>
              <TableCell>{t(`source.${row.source}` as "source.admin")}</TableCell>
              <TableCell className="max-w-[280px] truncate">{row.details ?? "—"}</TableCell>
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
