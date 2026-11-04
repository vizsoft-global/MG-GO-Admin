"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Gauge, PlayCircle, Wrench, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppListCard } from "@/components/app/app-list-card";
import { queryKeys } from "@/lib/query/query-keys";
import {
  saveMaintenanceExclusion,
  startMaintenanceMonitoring,
} from "./service-actions";
import { serviceErrorKey } from "./use-service";
import { ServiceBaselineDialog } from "./service-baseline-dialog";
import { ServiceOdometerDialog } from "./service-odometer-dialog";
import type { MaintenanceProgramRow } from "./types";

type BaselineTarget = {
  vehicleId: string;
  programKey: string;
  plate: string;
  programLabel: string;
  currentKm: number | null;
};

/**
 * The two worklists the client asked to see beside the figures.
 *
 * **Needs setup** is the honest home for a program that has a rule but no record:
 * the operator either enters the last service, starts the clock today, or says
 * the program does not apply. All three are one click from the row that needs
 * them, and none of them is a silent default.
 *
 * **Needs odometer** lists the vehicles whose kilometres decide a program but
 * whose stored reading is missing — until the rider app captures a shift-out
 * reading, this is where the correction happens, through the same monotonic
 * guard every other reading uses.
 */
export function ServiceNeedsSetupPanel({
  canManage,
  setupRows,
  noRuleRows,
  odometerRows,
  today,
  onAddRule,
}: {
  canManage: boolean;
  setupRows: readonly MaintenanceProgramRow[];
  /** Program × vehicle rows the approved rules do not cover at all. */
  noRuleRows: readonly MaintenanceProgramRow[];
  odometerRows: readonly MaintenanceProgramRow[];
  today: string;
  onAddRule: () => void;
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState<BaselineTarget | null>(null);
  const [odometerTarget, setOdometerTarget] = useState<{
    vehicleId: string;
    currentKm: number | null;
    plate: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  }

  async function startMonitoring(row: MaintenanceProgramRow) {
    setBusy(`${row.vehicleId}_${row.programKey}`);
    const result = await startMaintenanceMonitoring({
      vehicleId: row.vehicleId,
      programKey: row.programKey,
    });
    setBusy(null);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("maintenance.setupStarted", { program: row.programLabel }));
    refresh();
  }

  async function notTracked(row: MaintenanceProgramRow) {
    setBusy(`${row.vehicleId}_${row.programKey}`);
    const result = await saveMaintenanceExclusion({
      vehicleId: row.vehicleId,
      programKey: row.programKey,
    });
    setBusy(null);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("maintenance.setupNotTracked", { program: row.programLabel }));
    refresh();
  }

  if (setupRows.length === 0 && odometerRows.length === 0 && noRuleRows.length === 0) return null;

  // Grouped by make and program, so ten Changan oil rows read as one line rather
  // than ten identical ones.
  const noRuleByMake = new Map<string, { label: string; rows: MaintenanceProgramRow[] }>();
  for (const row of noRuleRows) {
    const key = `${row.make ?? row.model ?? "—"}|${row.programKey}`;
    const label = `${row.make ?? row.model ?? "—"} · ${row.programLabel}`;
    const entry = noRuleByMake.get(key);
    if (entry) entry.rows.push(row);
    else noRuleByMake.set(key, { label, rows: [row] });
  }
  const noRuleGroups = [...noRuleByMake.values()];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {noRuleGroups.length > 0 ? (
        <AppListCard>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">{t("maintenance.noRuleTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("maintenance.noRuleHint")}</p>
            </div>
            <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">
              {noRuleRows.length}
            </Badge>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {noRuleGroups.slice(0, 40).map((group) => (
              <li key={group.label} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <span className="font-medium">{group.label}</span>
                <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                  {t("maintenance.noRuleCount", { count: group.rows.length })}
                </Badge>
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="ms-auto h-8 px-2 text-xs"
                    onClick={onAddRule}
                  >
                    <Wrench className="me-1 h-3.5 w-3.5" />
                    {t("maintenance.setupAddRule")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </AppListCard>
      ) : null}

      {setupRows.length > 0 ? (
        <AppListCard>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">{t("maintenance.setupTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("maintenance.setupHint")}</p>
            </div>
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800">
              {setupRows.length}
            </Badge>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {setupRows.slice(0, 40).map((row) => {
              const key = `${row.vehicleId}_${row.programKey}`;
              const missing =
                row.byKm === "needs_baseline" && row.byTime === "needs_baseline"
                  ? t("maintenance.setupMissingBoth")
                  : row.byKm === "needs_baseline"
                    ? t("maintenance.setupMissingKm")
                    : t("maintenance.setupMissingDate");
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
                >
                  <span className="font-medium tabular-nums">{row.plate}</span>
                  <span className="text-muted-foreground">{row.programLabel}</span>
                  <span className="text-xs text-muted-foreground">· {missing}</span>
                  {canManage ? (
                    <span className="ms-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={busy === key}
                        onClick={() =>
                          setBaseline({
                            vehicleId: row.vehicleId,
                            programKey: row.programKey,
                            plate: row.plate,
                            programLabel: row.programLabel,
                            currentKm: row.currentKm,
                          })
                        }
                      >
                        <Wrench className="me-1 h-3.5 w-3.5" />
                        {t("maintenance.setupEnterLast")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={busy === key}
                        onClick={() => void startMonitoring(row)}
                      >
                        <PlayCircle className="me-1 h-3.5 w-3.5" />
                        {t("maintenance.setupStartToday")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={busy === key}
                        onClick={() => void notTracked(row)}
                      >
                        <XCircle className="me-1 h-3.5 w-3.5" />
                        {t("maintenance.setupNotTrackedAction")}
                      </Button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </AppListCard>
      ) : null}

      {odometerRows.length > 0 ? (
        <AppListCard>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">{t("maintenance.odometerTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("maintenance.odometerHint")}</p>
            </div>
            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
              {odometerRows.length}
            </Badge>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {odometerRows.slice(0, 40).map((row) => (
              <li key={`${row.vehicleId}_odo`} className="flex items-center gap-2 px-4 py-2 text-sm">
                <span className="font-medium tabular-nums">{row.plate}</span>
                <span className="text-muted-foreground">{row.programLabel}</span>
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="ms-auto h-8 px-2 text-xs"
                    onClick={() =>
                      setOdometerTarget({
                        vehicleId: row.vehicleId,
                        currentKm: row.currentKm,
                        plate: row.plate,
                      })
                    }
                  >
                    <Gauge className="me-1 h-3.5 w-3.5" />
                    {t("actions.updateOdometer")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </AppListCard>
      ) : null}

      <ServiceBaselineDialog
        target={baseline}
        today={today}
        onOpenChange={(open) => {
          if (!open) setBaseline(null);
        }}
        onSaved={refresh}
      />

      {odometerTarget ? (
        <ServiceOdometerDialog
          vehicleId={odometerTarget.vehicleId}
          currentKm={odometerTarget.currentKm}
          open
          onOpenChange={(open) => {
            if (!open) setOdometerTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
