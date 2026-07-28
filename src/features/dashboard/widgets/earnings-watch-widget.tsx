"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import type { EarningsWatchRow } from "../types";
import { DashboardWidget } from "./dashboard-widget";

export function EarningsWatchWidget({
  rows,
  locale,
}: {
  rows: EarningsWatchRow[];
  locale: string;
}) {
  const t = useTranslations("pages.dashboard");

  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.estimatedKwd - a.estimatedKwd),
    [rows],
  );

  return (
    <DashboardWidget title={t("widgetEarningsWatch")} href={`/${locale}/earnings`}>
      {sorted.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colDeliveries")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colIncentive")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colEstimated")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colAlerts")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.slice(0, 10).map((row) => (
              <TableRow key={row.driverId}>
                <TableCell className="text-xs">
                  <p className="font-medium">{row.driverName}</p>
                  <p className="text-muted-foreground">#{row.driverCode}</p>
                </TableCell>
                <TableCell className="text-xs tabular-nums">{row.deliveries}</TableCell>
                <TableCell className="text-xs tabular-nums">{row.incentiveKwd.toFixed(3)}</TableCell>
                <TableCell className="text-xs font-medium tabular-nums">
                  {row.estimatedKwd.toFixed(3)} KWD
                </TableCell>
                <TableCell className="text-xs">
                  {row.anomalies.length === 0 ? (
                    "—"
                  ) : (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="size-3.5" />
                      {row.anomalies.map((a) => t(`earningsAnomaly.${a}`)).join(", ")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </DashboardWidget>
  );
}
